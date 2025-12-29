import * as vscode from 'vscode';
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
    
    const configManager = new ConfigManager();
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
            const config = await configManager.loadConfig();
            const serverName = config.serverUrl ? new URL(config.serverUrl).hostname : '未连接';
            
            if (treeDataProvider.isConnectedToServer()) {
                treeView.description = `已连接: ${serverName}`;
                treeView.title = `WebDAV: ${serverName}`;
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
        vscode.commands.registerCommand('webdav.connect', async () => {
            try {
                logger.info('正在连接WebDAV服务器...');
                await treeDataProvider.connect();
                isWebDAVConnected = true;
                await updateTreeViewDescription();
                logger.info('连接命令执行完成');
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error('连接失败', errorMsg);
                // 错误已经在treeDataProvider中处理
            }
        }),
        
        vscode.commands.registerCommand('webdav.openSettings', async () => {
            logger.info('打开设置');
            await vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
        }),
        
        vscode.commands.registerCommand('webdav.disconnect', async () => {
            logger.info('断开连接');
            treeDataProvider.disconnect();
            isWebDAVConnected = false;
            await updateTreeViewDescription();
            vscode.window.showInformationMessage('已断开WebDAV连接');
            logger.info('已断开WebDAV连接');
        }),
        
        vscode.commands.registerCommand('webdav.openDocumentsFolder', async () => {
            try {
                logger.info('打开Documents文件夹');
                await configManager.openDocumentsFolder();
                logger.info('已打开文档文件夹');
            } catch (error) {
                logger.error('打开文档文件夹失败', error);
            }
        }),
        
        vscode.commands.registerCommand('webdav.refresh', async () => {
            logger.info('刷新WebDAV文件列表');
            await treeDataProvider.refresh();
            vscode.window.showInformationMessage('已刷新WebDAV文件列表');
            logger.info('刷新WebDAV文件列表完成');
        }),
        
        vscode.commands.registerCommand('webdav.openLocalFolder', async () => {
            logger.info('打开本地同步文件夹');
            const config = await configManager.loadConfig();
            const syncPath = config.localSyncPath || configManager.getLocalSyncPath();
            
            try {
                const { exec } = require('child_process');
                const platform = require('os').platform();
                let command = '';
                
                if (platform === 'win32') {
                    command = `explorer "${syncPath}"`;
                } else if (platform === 'darwin') {
                    command = `open "${syncPath}"`;
                } else if (platform === 'linux') {
                    command = `xdg-open "${syncPath}"`;
                }
                
                if (command) {
                    logger.debug(`执行命令: ${command}`);
                    exec(command);
                    logger.info(`已打开本地同步文件夹: ${syncPath}`);
                }
            } catch (error) {
                logger.error('打开本地同步文件夹失败', error);
                vscode.window.showErrorMessage('打开本地同步文件夹失败');
            }
        }),
        
        vscode.commands.registerCommand('webdav.createFile', async (item?: WebDAVTreeItem) => {
            const parentPath = item?.relativePath || '/';
            logger.info('创建文件', { path: parentPath });
            await treeDataProvider.createFile(item);
        }),
        
        vscode.commands.registerCommand('webdav.createFolder', async (item?: WebDAVTreeItem) => {
            const parentPath = item?.relativePath || '/';
            logger.info('创建文件夹', { path: parentPath });
            await treeDataProvider.createFolder(item);
        }),
        
        vscode.commands.registerCommand('webdav.delete', async (item?: WebDAVTreeItem) => {
            if (!item) {
                // 尝试从当前选择获取
                const selection = treeView.selection[0];
                if (!selection) {
                    vscode.window.showWarningMessage('请先选择一个文件或文件夹');
                    return;
                }
                item = selection;
            }
            logger.info('删除项目', { label: item?.label, path: item?.path });
            await treeDataProvider.deleteItem(item);
        }),
        
        vscode.commands.registerCommand('webdav.openFile', async (item: WebDAVTreeItem) => {
            logger.info('打开文件', { label: item?.label, path: item?.path });
            await treeDataProvider.openFile(item);
        }),
        
        vscode.commands.registerCommand('webdav.download', async (item?: WebDAVTreeItem) => {
            if (!item) {
                // 尝试从当前选择获取
                const selection = treeView.selection[0];
                if (!selection) {
                    vscode.window.showWarningMessage('请先选择一个文件或文件夹');
                    return;
                }
                item = selection;
            }
            logger.info('下载文件', { label: item?.label, path: item?.path });
            await treeDataProvider.downloadItem(item);
        }),
        
        vscode.commands.registerCommand('webdav.upload', async (item?: WebDAVTreeItem) => {
            const parentPath = item?.relativePath || '/';
            logger.info('上传文件', { path: parentPath });
            await treeDataProvider.uploadFile(item);
        }),
        
        vscode.commands.registerCommand('webdav.reconnect', async () => {
            logger.info('重新连接WebDAV服务器...');
            try {
                treeDataProvider.disconnect();
                await treeDataProvider.connect();
                isWebDAVConnected = true;
                await updateTreeViewDescription();
                logger.info('重新连接完成');
                vscode.window.showInformationMessage('重新连接成功');
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error('重新连接失败', errorMsg);
                vscode.window.showErrorMessage(`重新连接失败: ${errorMsg}`);
            }
        }),
        
        vscode.commands.registerCommand('webdav.saveFile', async (item?: WebDAVTreeItem) => {
            if (!item || item.type !== 'file') {
                vscode.window.showWarningMessage('请选择一个文件');
                return;
            }
            
            try {
                logger.info(`保存云端文件: ${item.label}`);
                const files = fileSystemProvider.getOpenFiles();
                const virtualFile = files.find(f => f.webdavPath === item.path);
                
                if (!virtualFile) {
                    vscode.window.showWarningMessage(`文件未在编辑中: ${item.label}`);
                    return;
                }
                
                const uri = fileSystemProvider.createVirtualFileUri(item.path, item.label);
                const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
                
                if (document) {
                    const content = document.getText();
                    await fileSystemProvider.saveFile(uri, content);
                    vscode.window.setStatusBarMessage(`已保存到云端: ${item.label}`, 2000);
                } else {
                    vscode.window.showErrorMessage(`无法找到文档: ${item.label}`);
                }
            } catch (error) {
                logger.error('保存文件失败', error);
                vscode.window.showErrorMessage(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        
        vscode.commands.registerCommand('webdav.openPreview', async (item?: WebDAVTreeItem) => {
            if (!item || item.type !== 'file' || item.fileType !== 'markdown') {
                vscode.window.showWarningMessage('请选择一个Markdown文件');
                return;
            }
            
            try {
                logger.info(`打开Markdown预览: ${item.label}`);
                // 先打开文件
                await treeDataProvider.openFile(item);
                // 再打开预览
                await vscode.commands.executeCommand('markdown.showPreview');
            } catch (error) {
                logger.error('打开预览失败', error);
            }
        }),
        
        vscode.commands.registerCommand('webdav.saveAll', async () => {
            logger.info('保存所有文件到云端');
            try {
                const result = await fileSystemProvider.saveAll();
                if (result.success > 0) {
                    vscode.window.showInformationMessage(`已保存 ${result.success} 个文件到云端`);
                }
                if (result.fail > 0) {
                    vscode.window.showWarningMessage(`有 ${result.fail} 个文件保存失败`);
                }
                if (result.success === 0 && result.fail === 0) {
                    vscode.window.showInformationMessage('没有需要保存的文件');
                }
            } catch (error) {
                logger.error('保存所有文件失败', error);
                vscode.window.showErrorMessage('保存所有文件失败');
            }
        }),
        
        vscode.commands.registerCommand('webdav.closeAll', async () => {
            logger.info('关闭所有云端文件');
            fileSystemProvider.closeAll();
            vscode.window.showInformationMessage('已关闭所有云端文件');
        }),
        
        vscode.commands.registerCommand('webdav.showEditingFiles', async () => {
            const files = fileSystemProvider.getOpenFiles();
            if (files.length === 0) {
                vscode.window.showInformationMessage('没有正在编辑的云端文件');
                return;
            }
            
            const items = files.map(file => ({
                label: file.fileName,
                description: file.isDirty ? '已修改' : '已保存',
                detail: file.webdavPath
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要查看的文件',
                matchOnDetail: true
            });
            
            if (selected) {
                const file = files.find(f => f.fileName === selected.label && f.webdavPath === selected.detail);
                if (file) {
                    const uri = fileSystemProvider.createVirtualFileUri(file.webdavPath, file.fileName);
                    const document = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(document, {
                        preview: false,
                        viewColumn: vscode.ViewColumn.Active
                    });
                }
            }
        }),
        
        // 显示项目操作菜单 - 修复空目录项的处理
        vscode.commands.registerCommand('webdav.showItemActions', async (item?: WebDAVTreeItem) => {
            if (!item) {
                // 如果没有传入item，尝试从当前选择获取
                const selection = treeView.selection[0];
                if (!selection) {
                    vscode.window.showWarningMessage('请先选择一个项目');
                    return;
                }
                item = selection;
            }
            
            // 创建操作菜单
            const actions: { label: string; description: string; command: string; item?: any }[] = [];
            
            if (item.type === 'file') {
                actions.push(
                    { label: '$(file) 打开文件', description: '在编辑器中打开', command: 'webdav.openFile' },
                    { label: '$(cloud-download) 下载', description: '下载到本地', command: 'webdav.download' },
                    { label: '$(trash) 删除', description: '从云端删除', command: 'webdav.delete' },
                    { label: '$(save) 保存', description: '保存到云端', command: 'webdav.saveFile' }
                );
                
                if (item.fileType === 'markdown') {
                    actions.push(
                        { label: '$(preview) 预览', description: '预览Markdown', command: 'webdav.openPreview' }
                    );
                }
            } else if (item.type === 'directory') {
                if (item.id === 'connect' || item.id === 'auth-error' || 
                    item.id === 'network-error' || item.id === 'error' || 
                    item.id === 'path-error' || item.id === 'timeout-error') {
                    // 错误状态显示连接操作
                    actions.push(
                        { label: '$(cloud) 连接', description: '连接到WebDAV服务器', command: 'webdav.connect' },
                        { label: '$(refresh) 刷新', description: '刷新列表', command: 'webdav.refresh' }
                    );
                } else if (item.id === 'empty') {
                    // 空目录显示创建操作
                    actions.push(
                        { label: '$(new-file) 新建文件', description: '在目录中创建新文件', command: 'webdav.createFile' },
                        { label: '$(new-folder) 新建文件夹', description: '在目录中创建新文件夹', command: 'webdav.createFolder' },
                        { label: '$(cloud-upload) 上传', description: '上传文件到此目录', command: 'webdav.upload' },
                        { label: '$(refresh) 刷新', description: '刷新列表', command: 'webdav.refresh' }
                    );
                } else {
                    // 正常目录显示完整操作
                    actions.push(
                        { label: '$(new-file) 新建文件', description: '在目录中创建新文件', command: 'webdav.createFile' },
                        { label: '$(new-folder) 新建文件夹', description: '在目录中创建新文件夹', command: 'webdav.createFolder' },
                        { label: '$(cloud-upload) 上传', description: '上传文件到此目录', command: 'webdav.upload' },
                        { label: '$(trash) 删除', description: '删除此目录', command: 'webdav.delete' },
                        { label: '$(cloud-download) 下载', description: '下载整个目录', command: 'webdav.download' }
                    );
                }
            }
            
            // 添加通用操作
            if (item.id !== 'connect' && item.id !== 'empty') {
                actions.push(
                    { label: '$(refresh) 刷新', description: '刷新列表', command: 'webdav.refresh' }
                );
            }
            
            const items = actions.map(action => ({
                label: action.label,
                description: action.description,
                command: action.command
            }));
            
            // 显示快速选择菜单
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `选择对 "${item.label}" 的操作`,
                matchOnDescription: true
            });
            
            if (!selected) return;
            
            // 执行选中的操作
            await vscode.commands.executeCommand(selected.command, item);
        }),
        
        // 快速操作命令 - 用于标题栏按钮
        vscode.commands.registerCommand('webdav.quickCreateFile', async () => {
            // 获取当前选中的目录或使用根目录
            const selection = treeView.selection[0];
            const parentPath = selection && selection.type === 'directory' ? selection.relativePath : '/';
            
            const fileName = await vscode.window.showInputBox({
                prompt: '请输入文件名',
                placeHolder: '例如: newfile.txt',
                validateInput: (value) => {
                    if (!value.trim()) return '文件名不能为空';
                    if (value.includes('/') || value.includes('\\')) return '文件名不能包含路径分隔符';
                    return null;
                }
            });

            if (fileName) {
                await treeDataProvider.createFile(selection);
            }
        }),
        
        vscode.commands.registerCommand('webdav.quickCreateFolder', async () => {
            // 获取当前选中的目录或使用根目录
            const selection = treeView.selection[0];
            const parentPath = selection && selection.type === 'directory' ? selection.relativePath : '/';
            
            await treeDataProvider.createFolder(selection);
        }),
        
        vscode.commands.registerCommand('webdav.quickDelete', async () => {
            // 获取当前选中的项目
            const selection = treeView.selection[0];
            if (!selection) {
                vscode.window.showWarningMessage('请先选择一个文件或文件夹');
                return;
            }
            
            await treeDataProvider.deleteItem(selection);
        }),
        
        vscode.commands.registerCommand('webdav.quickDownload', async () => {
            // 获取当前选中的项目
            const selection = treeView.selection[0];
            if (!selection) {
                vscode.window.showWarningMessage('请先选择一个文件或文件夹');
                return;
            }
            
            await treeDataProvider.downloadItem(selection);
        }),
        
        vscode.commands.registerCommand('webdav.quickUpload', async () => {
            // 获取当前选中的目录或使用根目录
            const selection = treeView.selection[0];
            const parentPath = selection && selection.type === 'directory' ? selection.relativePath : '/';
            
            await treeDataProvider.uploadFile(selection);
        }),
        
        // 调试连接命令
        vscode.commands.registerCommand('webdav.debugConnection', async () => {
            try {
                const config = await configManager.loadConfig();
                
                if (!config.serverUrl || !config.username || !config.password) {
                    vscode.window.showErrorMessage('请先配置服务器地址、用户名和密码', '打开设置').then(selection => {
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
        
        // 检查连接状态
        vscode.commands.registerCommand('webdav.checkConnection', async () => {
            if (treeDataProvider.isConnectedToServer()) {
                const config = await configManager.loadConfig();
                const serverName = config.serverUrl ? new URL(config.serverUrl).hostname : '未知服务器';
                vscode.window.showInformationMessage(`已连接到 ${serverName}`);
            } else {
                const status = treeDataProvider.getConnectionStatus();
                if (status === 'connecting') {
                    vscode.window.showInformationMessage('正在连接中...');
                } else if (status === 'error') {
                    const error = treeDataProvider.getLastError();
                    vscode.window.showWarningMessage(`连接错误: ${error || '未知错误'}`);
                } else {
                    vscode.window.showInformationMessage('未连接');
                }
            }
        }),
        
        // 测试连接并创建测试文件
        vscode.commands.registerCommand('webdav.testCreate', async () => {
            try {
                const config = await configManager.loadConfig();
                
                if (!config.serverUrl || !config.username || !config.password) {
                    vscode.window.showErrorMessage('请先配置服务器地址、用户名和密码');
                    return;
                }
                
                const testWebdavClient = new MyWebDAVClient(context);
                
                await testWebdavClient.connect(
                    config.serverUrl,
                    config.username,
                    config.password,
                    config.basePath
                );
                
                const testPath = config.basePath === '/' ? '/testfile.md' : `${config.basePath}/testfile.md`;
                await testWebdavClient.createFile(testPath, '# 测试文件\n这是测试内容');
                
                vscode.window.showInformationMessage('测试文件创建成功，请刷新查看');
                
                // 刷新树视图
                await treeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`测试失败: ${error instanceof Error ? error.message : String(error)}`);
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
    
    // 尝试自动连接
    try {
        logger.info('测试配置加载...');
        const config = await configManager.loadConfig();
        
        // 检查配置是否完整
        const hasCompleteConfig = config.serverUrl && config.username && config.password;
        
        logger.info('配置检查', {
            serverUrl: config.serverUrl || '未设置',
            username: config.username || '未设置',
            basePath: config.basePath || '/',
            hasPassword: !!config.password,
            hasCompleteConfig
        });
        
        if (hasCompleteConfig) {
            logger.info('检测到完整配置，将在2秒后尝试自动连接...');
            
            // 延迟连接，确保UI完全加载
            setTimeout(async () => {
                try {
                    logger.info('开始自动连接...');
                    
                    // 显示连接状态
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Window,
                        title: '正在自动连接WebDAV...',
                        cancellable: false
                    }, async (progress) => {
                        progress.report({ increment: 0 });
                        
                        const connected = await treeDataProvider.tryAutoConnect();
                        if (connected) {
                            isWebDAVConnected = true;
                            await updateTreeViewDescription();
                            await treeDataProvider.refresh();
                            logger.info('自动连接完成');
                            progress.report({ increment: 100 });
                        } else {
                            logger.info('自动连接失败，需要手动连接');
                        }
                    });
                    
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    logger.info('自动连接失败:', errorMsg);
                    
                    // 仅在重要错误时显示提示
                    if (errorMsg.includes('401') || errorMsg.includes('认证失败')) {
                        vscode.window.showWarningMessage('WebDAV自动连接失败: 认证失败，请检查用户名和密码');
                    }
                }
            }, 2000);
        } else {
            logger.info('配置不完整，跳过自动连接');
            const missingFields: string[] = [];
            if (!config.serverUrl) missingFields.push('服务器地址');
            if (!config.username) missingFields.push('用户名');
            if (!config.password) missingFields.push('密码');
            
            logger.info(`请设置: ${missingFields.join(', ')}`);
            
            // 显示友好提示
            if (missingFields.length > 0) {
                setTimeout(() => {
                    vscode.window.showInformationMessage(
                        `WebDAV扩展已加载，请配置${missingFields.join('、')}`,
                        '打开设置'
                    ).then(selection => {
                        if (selection === '打开设置') {
                            vscode.commands.executeCommand('webdav.openSettings');
                        }
                    });
                }, 3000);
            }
        }
    } catch (error) {
        logger.error('配置加载测试失败', error);
    }
    
    logger.info('WebDAV Markdown Manager 扩展激活完成');
}

export function deactivate() {
    logger.info('WebDAV Markdown Manager 扩展已停用');
    console.log('WebDAV Markdown Manager 扩展已停用');
}