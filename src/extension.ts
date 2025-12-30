import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import { ConfigManager } from './configManager';
import { WebDAVTreeDataProvider, WebDAVTreeItem } from './treeDataProvider';
import { MyWebDAVClient } from './webdavClient';
import { WebDAVFileManager } from './syncEditorManager';
import { WebDAVFileSystemProvider } from './webdavFileSystemProvider';
import { testWebDAVConnection } from './debugHelper';

export async function activate(context: vscode.ExtensionContext) {
    console.log('WebDAV Markdown Manager 扩展正在激活...');
    logger.info('扩展激活开始');
    
    const outputChannel = vscode.window.createOutputChannel('WebDAV');
    logger.setOutputChannel(outputChannel);
    
    logger.info('WebDAV Markdown Manager 扩展已激活');
    
    const configManager = ConfigManager.getInstance();
    logger.debug('配置管理器已初始化');
    
    const webdavClient = new MyWebDAVClient(context);
    logger.debug('WebDAV客户端已初始化');
    
    // 初始化文件系统提供程序
    const fileSystemProvider = new WebDAVFileSystemProvider();
    fileSystemProvider.setWebDAVClient(webdavClient);
    fileSystemProvider.setConfigManager(configManager);
    
    // 注册文件系统提供程序
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('webdav-file', fileSystemProvider, {
            isCaseSensitive: false,
            isReadonly: false
        })
    );
    logger.debug('WebDAV文件系统提供程序已注册');
    
    // 初始化文件管理器
    const fileManager = WebDAVFileManager.getInstance();
    fileManager.setWebDAVClient(webdavClient);
    fileManager.setConfigManager(configManager);
    fileManager.setFileSystemProvider(fileSystemProvider);
    logger.debug('文件管理器已初始化');
    
    const treeDataProvider = new WebDAVTreeDataProvider();
    treeDataProvider.setWebDAVClient(webdavClient);
    treeDataProvider.setConfigManager(configManager);
    treeDataProvider.setFileSystemProvider(fileSystemProvider);
    logger.debug('TreeDataProvider已初始化');
    
    // 创建TreeView
    const treeView = vscode.window.createTreeView('webdavExplorer', {
        treeDataProvider,
        showCollapseAll: true
    });
    logger.debug('TreeView已创建');
    
    // 设置TreeView的标题和描述
    treeView.title = 'WebDAV 文件管理器';
    treeView.description = '未连接';
    
    // 监听连接状态变化
    let isWebDAVConnected = false;
    
    // 更新TreeView描述以显示连接状态
    const updateTreeViewDescription = async () => {
        if (treeView.visible) {
            if (treeDataProvider.isConnectedToServer()) {
                treeView.description = `已连接`;
                treeView.title = `WebDAV 文件管理器`;
            } else {
                const status = treeDataProvider.getConnectionStatus();
                if (status === 'connecting') {
                    treeView.description = '连接中...';
                } else if (status === 'error') {
                    treeView.description = '连接错误';
                } else {
                    treeView.description = '未连接';
                }
                treeView.title = 'WebDAV 文件管理器';
            }
        }
    };
    
    // 监听树视图可见性变化
    treeView.onDidChangeVisibility(() => {
        updateTreeViewDescription();
    });
    
    // 注册所有命令
    const commands = [
        // 连接命令 - 通用连接
        vscode.commands.registerCommand('webdav.connect', async () => {
            try {
                logger.info('正在连接WebDAV服务器...');
                
                // 先加载配置并显示详情
                const config = await configManager.loadConfig();
                logger.info('连接命令获取的配置:', {
                    serverUrl: config.serverUrl || '空',
                    username: config.username || '空',
                    password: config.password ? '已设置' : '未设置',
                    basePath: config.basePath
                });
                
                // 检查配置
                const configCheck = await configManager.checkConfiguration();
                logger.info(`配置检查结果: isValid=${configCheck.isValid}, missingFields=${configCheck.missingFields.join(', ')}`);
                
                if (!configCheck.isValid) {
                    const message = `配置不完整，请设置: ${configCheck.missingFields.join(', ')}\n\n` +
                                   `当前配置:\n` +
                                   `• 服务器地址: ${configCheck.config.serverUrl || '未设置'}\n` +
                                   `• 用户名: ${configCheck.config.username || '未设置'}\n` +
                                   `• 密码: ${configCheck.config.password ? '已设置' : '未设置'}`;
                    
                    vscode.window.showErrorMessage(
                        message, 
                        '打开设置',
                        '调试连接'
                    ).then(selection => {
                        if (selection === '打开设置') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
                        } else if (selection === '调试连接') {
                            vscode.commands.executeCommand('webdav.debugConnection');
                        }
                    });
                    return;
                }
                
                // 显示连接进度
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '连接WebDAV服务器...',
                    cancellable: true
                }, async (progress, token) => {
                    progress.report({ message: '正在连接...' });
                    await treeDataProvider.connect();
                });
                
                isWebDAVConnected = true;
                await updateTreeViewDescription();
                logger.info('连接命令执行完成');
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error('连接失败', errorMsg);
                vscode.window.showErrorMessage(`连接失败: ${errorMsg}`, '查看详情', '重试').then(selection => {
                    if (selection === '查看详情') {
                        outputChannel.show();
                    } else if (selection === '重试') {
                        vscode.commands.executeCommand('webdav.connect');
                    }
                });
            }
        }),
        
        // 打开设置命令
        vscode.commands.registerCommand('webdav.openSettings', async () => {
            logger.info('打开设置');
            await vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
        }),
        
        // 断开连接命令
        vscode.commands.registerCommand('webdav.disconnect', async () => {
            logger.info('断开连接');
            treeDataProvider.disconnect();
            isWebDAVConnected = false;
            await updateTreeViewDescription();
            vscode.window.showInformationMessage('已断开WebDAV连接');
            logger.info('已断开WebDAV连接');
        }),
        
        // 调试连接命令
        vscode.commands.registerCommand('webdav.debugConnection', async () => {
            try {
                const config = await configManager.loadConfig();
                
                if (!config.serverUrl || !config.username) {
                    vscode.window.showErrorMessage('请先配置服务器地址和用户名', '打开设置').then(selection => {
                        if (selection === '打开设置') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
                        }
                    });
                    return;
                }
                
                await testWebDAVConnection(
                    config.serverUrl,
                    config.username,
                    config.password,
                    config.basePath
                );
            } catch (error) {
                logger.error('调试连接失败', error);
                vscode.window.showErrorMessage(`调试连接失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 打开本地文件夹命令
        vscode.commands.registerCommand('webdav.openLocalFolder', async () => {
            try {
                logger.info('打开本地同步文件夹');
                const configCheck = await configManager.checkConfiguration();
                const localSyncPath = configCheck.config.localSyncPath || configManager.getLocalSyncPath();
                
                if (!localSyncPath) {
                    vscode.window.showErrorMessage('本地同步路径未配置');
                    return;
                }
                
                // 确保文件夹存在
                if (!fs.existsSync(localSyncPath)) {
                    fs.mkdirSync(localSyncPath, { recursive: true });
                    logger.info(`创建本地同步文件夹: ${localSyncPath}`);
                }
                
                // 打开文件夹
                const platform = os.platform();
                let command: string;
                
                switch (platform) {
                    case 'win32':
                        command = `explorer "${localSyncPath}"`;
                        break;
                    case 'darwin':
                        command = `open "${localSyncPath}"`;
                        break;
                    case 'linux':
                        command = `xdg-open "${localSyncPath}"`;
                        break;
                    default:
                        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(localSyncPath));
                        return;
                }
                
                require('child_process').exec(command);
                logger.info(`已打开本地同步文件夹: ${localSyncPath}`);
            } catch (error) {
                logger.error('打开本地同步文件夹失败', error);
                vscode.window.showErrorMessage(`打开本地同步文件夹失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 显示项目操作菜单命令
        vscode.commands.registerCommand('webdav.showItemActions', async (item: WebDAVTreeItem) => {
            try {
                logger.info(`显示项目操作菜单: ${item?.label || '未知'}`);
                
                if (!item || !item.id) {
                    vscode.window.showWarningMessage('请先选择一个项目');
                    return;
                }
                
                const options = [];
                
                if (item.type === 'directory') {
                    options.push(
                        { label: '新建文件', description: '在当前目录创建新文件', command: 'webdav.createFile' },
                        { label: '新建文件夹', description: '在当前目录创建新文件夹', command: 'webdav.createFolder' },
                        { label: '上传文件', description: '上传文件到当前目录', command: 'webdav.upload' },
                        { label: '删除', description: '删除此文件夹', command: 'webdav.delete' },
                        { label: '刷新', description: '刷新当前目录', command: 'webdav.refresh' }
                    );
                } else if (item.type === 'file') {
                    options.push(
                        { label: '打开文件', description: '在编辑器中打开此文件', command: 'webdav.openFile' },
                        { label: '下载', description: '下载文件到本地', command: 'webdav.download' },
                        { label: '删除', description: '删除此文件', command: 'webdav.delete' }
                    );
                } else if (item.id === 'connect' || item.id === 'auth-error' || 
                          item.id === 'connection-error' || item.id === 'dns-error' ||
                          item.id === 'error' || item.id === 'path-error' ||
                          item.id === 'timeout-error') {
                    options.push(
                        { label: '连接服务器', description: '连接到WebDAV服务器', command: 'webdav.connect' },
                        { label: '打开设置', description: '配置WebDAV设置', command: 'webdav.openSettings' }
                    );
                } else if (item.id === 'empty') {
                    options.push(
                        { label: '新建文件', description: '在当前目录创建新文件', command: 'webdav.createFile' },
                        { label: '新建文件夹', description: '在当前目录创建新文件夹', command: 'webdav.createFolder' },
                        { label: '上传文件', description: '上传文件到当前目录', command: 'webdav.upload' }
                    );
                }
                
                const quickPick = vscode.window.createQuickPick();
                quickPick.items = options.map(option => ({
                    label: option.label,
                    description: option.description,
                    command: option.command
                }));
                
                quickPick.onDidChangeSelection(async (selection) => {
                    if (selection[0]) {
                        const selected = selection[0] as any;
                        quickPick.hide();
                        
                        try {
                            // 执行对应的命令
                            switch (selected.command) {
                                case 'webdav.createFile':
                                    await treeDataProvider.createFile(item);
                                    break;
                                case 'webdav.createFolder':
                                    await treeDataProvider.createFolder(item);
                                    break;
                                case 'webdav.delete':
                                    await treeDataProvider.deleteItem(item);
                                    break;
                                case 'webdav.download':
                                    await treeDataProvider.downloadItem(item);
                                    break;
                                case 'webdav.openFile':
                                    await treeDataProvider.openFile(item);
                                    break;
                                case 'webdav.upload':
                                    await treeDataProvider.uploadFile(item);
                                    break;
                                case 'webdav.connect':
                                    await vscode.commands.executeCommand('webdav.connect');
                                    break;
                                case 'webdav.openSettings':
                                    await vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
                                    break;
                                case 'webdav.refresh':
                                    await treeDataProvider.refresh();
                                    break;
                            }
                        } catch (error) {
                            logger.error(`执行命令 ${selected.command} 失败`, error);
                            vscode.window.showErrorMessage(`操作失败: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                });
                
                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
                
            } catch (error) {
                logger.error('显示操作菜单失败', error);
                vscode.window.showErrorMessage(`显示操作菜单失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 刷新命令
        vscode.commands.registerCommand('webdav.refresh', async () => {
            logger.info('刷新WebDAV文件列表');
            await treeDataProvider.refresh();
        }),
        
        // 创建文件命令 - 支持顶层文件夹操作
        vscode.commands.registerCommand('webdav.createFile', async (item?: any) => {
            logger.info('创建文件');
            if (item) {
                await treeDataProvider.createFile(item);
            } else {
                // 尝试从当前选择获取
                const selection = treeView.selection;
                if (selection && selection.length > 0) {
                    item = selection[0];
                    await treeDataProvider.createFile(item);
                } else {
                    // 使用根目录
                    await treeDataProvider.createFile('/');
                }
            }
        }),
        
        // 创建文件夹命令 - 支持顶层文件夹操作
        vscode.commands.registerCommand('webdav.createFolder', async (item?: any) => {
            logger.info('创建文件夹');
            if (item) {
                await treeDataProvider.createFolder(item);
            } else {
                // 尝试从当前选择获取
                const selection = treeView.selection;
                if (selection && selection.length > 0) {
                    item = selection[0];
                    await treeDataProvider.createFolder(item);
                } else {
                    // 使用根目录
                    await treeDataProvider.createFolder('/');
                }
            }
        }),
        
        // 删除命令
        vscode.commands.registerCommand('webdav.delete', async (item?: any) => {
            if (!item) {
                // 尝试从当前选择获取
                const selection = treeView.selection;
                if (selection && selection.length > 0) {
                    item = selection[0];
                }
            }
            
            if (item) {
                logger.info(`删除: ${item.label}`);
                await treeDataProvider.deleteItem(item);
            } else {
                vscode.window.showWarningMessage('请先选择要删除的项目');
            }
        }),
        
        // 打开文件命令
        vscode.commands.registerCommand('webdav.openFile', async (item?: any) => {
            if (!item) {
                // 尝试从当前选择获取
                const selection = treeView.selection;
                if (selection && selection.length > 0) {
                    item = selection[0];
                }
            }
            
            if (item && item.type === 'file') {
                logger.info(`打开文件: ${item.label}`);
                await treeDataProvider.openFile(item);
            } else {
                vscode.window.showWarningMessage('请先选择一个文件');
            }
        }),
        
        // 下载命令
        vscode.commands.registerCommand('webdav.download', async (item?: any) => {
            if (!item) {
                // 尝试从当前选择获取
                const selection = treeView.selection;
                if (selection && selection.length > 0) {
                    item = selection[0];
                }
            }
            
            if (item && item.type === 'file') {
                logger.info(`下载文件: ${item.label}`);
                await treeDataProvider.downloadItem(item);
            } else {
                vscode.window.showWarningMessage('请先选择一个文件');
            }
        }),
        
        // 上传命令 - 支持顶层文件夹操作
        vscode.commands.registerCommand('webdav.upload', async (item?: any) => {
            logger.info('上传文件');
            if (item) {
                await treeDataProvider.uploadFile(item);
            } else {
                // 尝试从当前选择获取
                const selection = treeView.selection;
                if (selection && selection.length > 0) {
                    item = selection[0];
                    await treeDataProvider.uploadFile(item);
                } else {
                    // 使用根目录
                    await treeDataProvider.uploadFile('/');
                }
            }
        }),
        
        // 保存文件命令
        vscode.commands.registerCommand('webdav.saveFile', async () => {
            try {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const uri = activeEditor.document.uri;
                    if (uri.scheme === 'webdav-file' && fileSystemProvider) {
                        const content = activeEditor.document.getText();
                        await fileSystemProvider.saveFile(uri, content);
                        vscode.window.showInformationMessage('文件已保存到云端');
                    } else {
                        vscode.window.showWarningMessage('当前文件不是云端文件');
                    }
                } else {
                    vscode.window.showWarningMessage('没有活动的编辑器');
                }
            } catch (error) {
                logger.error('保存文件失败', error);
                vscode.window.showErrorMessage(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 保存所有命令
        vscode.commands.registerCommand('webdav.saveAll', async () => {
            try {
                if (fileSystemProvider) {
                    const result = await fileSystemProvider.saveAll();
                    vscode.window.showInformationMessage(`已保存 ${result.success} 个文件到云端`);
                }
            } catch (error) {
                logger.error('保存所有文件失败', error);
                vscode.window.showErrorMessage(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 关闭所有命令
        vscode.commands.registerCommand('webdav.closeAll', () => {
            if (fileSystemProvider) {
                fileSystemProvider.closeAll();
                vscode.window.showInformationMessage('已关闭所有云端文件');
            }
        }),
        
        // 查看编辑文件命令
        vscode.commands.registerCommand('webdav.showEditingFiles', () => {
            if (fileSystemProvider) {
                const files = fileSystemProvider.getOpenFiles();
                if (files.length === 0) {
                    vscode.window.showInformationMessage('当前没有正在编辑的云端文件');
                    return;
                }
                
                const items = files.map(file => ({
                    label: file.fileName,
                    description: file.webdavPath,
                    detail: `大小: ${file.size} 字节, 修改时间: ${new Date(file.mtime).toLocaleString()}`,
                    file
                }));
                
                vscode.window.showQuickPick(items, {
                    placeHolder: '选择要查看的云端文件'
                }).then(selected => {
                    if (selected) {
                        vscode.window.showInformationMessage(`选中文件: ${selected.label}`);
                    }
                });
            }
        }),
        
        // 检查连接状态命令
        vscode.commands.registerCommand('webdav.checkConnection', async () => {
            try {
                if (webdavClient) {
                    const connectionStatus = await webdavClient.checkConnection();
                    if (connectionStatus.success) {
                        vscode.window.showInformationMessage(`连接状态: ${connectionStatus.message}`, '查看详情').then(selection => {
                            if (selection === '查看详情') {
                                const channel = vscode.window.createOutputChannel('WebDAV 连接状态');
                                channel.show();
                                channel.appendLine('=== WebDAV 连接状态检查 ===');
                                channel.appendLine(`时间: ${new Date().toLocaleString()}`);
                                channel.appendLine(`状态: ${connectionStatus.message}`);
                                channel.appendLine(`服务器: ${connectionStatus.details?.serverUrl || '未知'}`);
                                channel.appendLine(`基础路径: ${connectionStatus.details?.basePath || '/'}`);
                                channel.appendLine(`用户名: ${connectionStatus.details?.username || '未知'}`);
                                channel.appendLine('');
                                channel.appendLine('连接正常，可以正常使用WebDAV功能');
                            }
                        });
                    } else {
                        vscode.window.showErrorMessage(`连接状态: ${connectionStatus.message}`, '重新连接', '查看详情').then(selection => {
                            if (selection === '重新连接') {
                                vscode.commands.executeCommand('webdav.connect');
                            } else if (selection === '查看详情') {
                                const channel = vscode.window.createOutputChannel('WebDAV 连接状态');
                                channel.show();
                                channel.appendLine('=== WebDAV 连接状态检查 ===');
                                channel.appendLine(`时间: ${new Date().toLocaleString()}`);
                                channel.appendLine(`状态: ${connectionStatus.message}`);
                                if (connectionStatus.details) {
                                    channel.appendLine(`错误详情: ${JSON.stringify(connectionStatus.details, null, 2)}`);
                                }
                            }
                        });
                    }
                } else {
                    vscode.window.showWarningMessage('WebDAV客户端未初始化');
                }
            } catch (error) {
                logger.error('检查连接状态失败', error);
                vscode.window.showErrorMessage(`检查连接状态失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 重新连接命令
        vscode.commands.registerCommand('webdav.reconnect', async () => {
            logger.info('重新连接WebDAV服务器');
            treeDataProvider.disconnect();
            await vscode.commands.executeCommand('webdav.connect');
        }),
        
        // 预览Markdown命令
        vscode.commands.registerCommand('webdav.openPreview', async () => {
            try {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const document = activeEditor.document;
                    if (document.languageId === 'markdown') {
                        await vscode.commands.executeCommand('markdown.showPreview', document.uri);
                    } else {
                        vscode.window.showWarningMessage('当前文件不是Markdown文件');
                    }
                } else {
                    vscode.window.showWarningMessage('没有活动的编辑器');
                }
            } catch (error) {
                logger.error('打开预览失败', error);
                vscode.window.showErrorMessage(`打开预览失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        // 打开文档文件夹命令
        vscode.commands.registerCommand('webdav.openDocumentsFolder', async () => {
            try {
                await configManager.openDocumentsFolder();
            } catch (error) {
                logger.error('打开文档文件夹失败', error);
                vscode.window.showErrorMessage('打开Documents文件夹失败');
            }
        })
    ];
    
    // 将所有命令和视图添加到订阅中
    commands.forEach(command => context.subscriptions.push(command));
    context.subscriptions.push(treeView);
    
    // 初始刷新
    try {
        logger.info('初始刷新开始');
        await treeDataProvider.refresh();
        await updateTreeViewDescription();
        logger.info('初始刷新完成');
    } catch (error) {
        logger.error('初始刷新失败', error);
    }
    
    // 检查配置并提示 - 延迟执行
    setTimeout(async () => {
        try {
            logger.info('检查配置...');
            const configCheck = await configManager.checkConfiguration();
            
            if (!configCheck.isValid) {
                logger.info(`配置不完整: ${configCheck.missingFields.join(', ')}`);
                
                // 显示配置提示
                vscode.window.showInformationMessage(
                    `WebDAV扩展需要配置: ${configCheck.missingFields.join(', ')}`,
                    '立即配置',
                    '稍后提醒'
                ).then(selection => {
                    if (selection === '立即配置') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
                    }
                });
            } else {
                logger.info('配置完整，可以连接');
                // 可选：自动连接
                // await treeDataProvider.tryAutoConnect();
            }
        } catch (error) {
            logger.error('配置检查失败', error);
        }
    }, 3000);
    
    logger.info('WebDAV Markdown Manager 扩展激活完成');
}

export function deactivate() {
    logger.info('WebDAV Markdown Manager 扩展已停用');
    console.log('WebDAV Markdown Manager 扩展已停用');
}