import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MyWebDAVClient } from './webdavClient';
import { ConfigManager } from './configManager';
import { WebDAVFileSystemProvider } from './webdavFileSystemProvider';
import { logger } from './logger';

export interface WebDAVTreeItem {
    id: string;
    label: string;
    type: 'file' | 'directory';
    path: string;
    relativePath: string;
    isDownloadable?: boolean;
    fileType?: string;
    size?: number;
    modified?: Date;
    children?: WebDAVTreeItem[];
}

export class WebDAVTreeDataProvider implements vscode.TreeDataProvider<WebDAVTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WebDAVTreeItem | undefined | null | void> = new vscode.EventEmitter<WebDAVTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WebDAVTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private treeItems: WebDAVTreeItem[] = [];
    private isConnected: boolean = false;
    private webdavClient: MyWebDAVClient | null = null;
    private configManager: ConfigManager;
    private fileSystemProvider: WebDAVFileSystemProvider | null = null;
    private isConnecting: boolean = false;
    private currentBasePath: string = '/';
    private saveListeners: Map<string, vscode.Disposable> = new Map();
    private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
    private lastError: string | null = null;

    constructor() {
        this.configManager = ConfigManager.getInstance();
    }

    public setWebDAVClient(client: MyWebDAVClient) {
        this.webdavClient = client;
        logger.debug('WebDAV客户端已设置');
    }
    
    public setConfigManager(configManager: ConfigManager) {
        this.configManager = configManager;
    }
    
    public setFileSystemProvider(provider: WebDAVFileSystemProvider) {
        this.fileSystemProvider = provider;
        logger.debug('文件系统提供程序已设置');
    }

    async connect(): Promise<void> {
        if (this.isConnecting) {
            logger.warn('已经在连接中，跳过重复连接');
            vscode.window.showWarningMessage('正在连接中，请稍候...');
            return;
        }

        if (this.isConnected) {
            logger.info('已经连接，刷新列表');
            await this.refresh();
            return;
        }

        this.isConnecting = true;
        this.connectionStatus = 'connecting';
        
        if (!this.webdavClient) {
            logger.error('WebDAV客户端未初始化');
            vscode.window.showErrorMessage('WebDAV客户端未初始化');
            this.isConnecting = false;
            this.connectionStatus = 'error';
            return;
        }

        try {
            // 检查配置
            const configCheck = await this.configManager.checkConfiguration();
            
            if (!configCheck.isValid) {
                logger.error(`配置不完整，缺少: ${configCheck.missingFields.join(', ')}`);
                vscode.window.showErrorMessage(
                    `请先在设置中配置: ${configCheck.missingFields.join(', ')}`, 
                    '打开设置'
                ).then(selection => {
                    if (selection === '打开设置') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
                    }
                });
                this.isConnecting = false;
                this.connectionStatus = 'error';
                return;
            }

            const config = configCheck.config;
            this.currentBasePath = config.basePath || '/';
            
            logger.info(`连接参数: serverUrl=${config.serverUrl}, basePath=${this.currentBasePath}`);
            
            // 显示连接进度
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在连接到服务器...`,
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    logger.info('用户取消了连接');
                    throw new Error('连接已取消');
                });

                progress.report({ increment: 10, message: '验证配置...' });
                
                // 连接服务器
                const connected = await this.webdavClient!.connect(
                    config.serverUrl,
                    config.username,
                    config.password,
                    this.currentBasePath
                );

                if (!connected) {
                    throw new Error('连接失败: 无法建立连接');
                }
                
                progress.report({ increment: 40, message: '验证登录信息...' });
                
                // 测试连接，确保可以访问目录
                try {
                    const contents = await this.webdavClient!.getDirectoryContents(this.currentBasePath);
                    const itemCount = Array.isArray(contents) ? contents.length : 0;
                    logger.info(`连接成功，获取到 ${itemCount} 个项目`);
                    progress.report({ increment: 30, message: `找到 ${itemCount} 个文件/文件夹...` });
                } catch (dirError: any) {
                    // 如果目录不存在但连接成功，尝试创建
                    if (dirError.message.includes('404') || dirError.message.includes('Not Found')) {
                        if (this.currentBasePath && this.currentBasePath !== '/') {
                            progress.report({ increment: 30, message: '创建目录...' });
                            try {
                                await this.webdavClient!.createDirectory(this.currentBasePath);
                                logger.info(`创建基础目录: ${this.currentBasePath}`);
                                progress.report({ increment: 20, message: '目录创建成功' });
                            } catch (createError: any) {
                                logger.warn(`无法创建目录 ${this.currentBasePath}: ${createError.message}`);
                                // 继续连接，可能是权限问题
                            }
                        }
                    } else {
                        throw dirError;
                    }
                }
                
                progress.report({ increment: 20, message: '完成连接...' });
            });

            this.isConnected = true;
            this.connectionStatus = 'connected';
            this.lastError = null;
            logger.info(`WebDAV 连接成功: ${config.serverUrl}`);
            
            // 刷新文件列表
            await this.refresh();
            
            // 显示连接成功消息
            const message = `已连接到服务器${this.currentBasePath !== '/' ? ` (${this.currentBasePath})` : ''}`;
            vscode.window.showInformationMessage(message);
            
        } catch (error: any) {
            this.isConnected = false;
            this.connectionStatus = 'error';
            this.lastError = error.message;
            logger.error('连接失败:', error);
            
            // 错误处理
            let errorMessage = '连接失败';
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                errorMessage = '认证失败，请检查用户名和密码';
            } else if (error.message.includes('404') || error.message.includes('Not Found')) {
                errorMessage = '服务器地址不存在或路径错误';
            } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
                errorMessage = '连接超时，请检查网络连接';
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = '无法连接到服务器，请检查服务器地址和端口';
            } else if (error.message.includes('ENOTFOUND')) {
                errorMessage = '服务器地址解析失败，请检查网络设置';
            } else if (error.message === '连接已取消') {
                errorMessage = '连接已取消';
            } else {
                errorMessage = `连接失败: ${error.message || '未知错误'}`;
            }
            
            this.treeItems = [{
                id: 'error',
                label: errorMessage,
                type: 'directory',
                path: '/',
                relativePath: '/',
                isDownloadable: false
            }];
            this._onDidChangeTreeData.fire();
            
            vscode.window.showErrorMessage(errorMessage, '检查设置', '重试').then(selection => {
                if (selection === '检查设置') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
                } else if (selection === '重试') {
                    setTimeout(() => this.connect(), 1000);
                }
            });
            
        } finally {
            this.isConnecting = false;
        }
    }

    async tryAutoConnect(): Promise<boolean> {
        if (this.isConnected || this.isConnecting) {
            logger.debug('已经连接或正在连接中，跳过自动连接');
            return this.isConnected;
        }
        
        if (!this.webdavClient) {
            logger.warn('WebDAV客户端未初始化，无法自动连接');
            return false;
        }
        
        try {
            // 检查配置是否完整
            const configCheck = await this.configManager.checkConfiguration();
            
            if (!configCheck.isValid) {
                logger.debug('配置不完整，跳过自动连接');
                return false;
            }

            const config = configCheck.config;
            this.currentBasePath = config.basePath || '/';
            
            logger.info('尝试自动连接WebDAV服务器...');
            
            const connected = await this.webdavClient.connect(
                config.serverUrl,
                config.username,
                config.password,
                this.currentBasePath
            );
            
            if (connected) {
                this.isConnected = true;
                this.connectionStatus = 'connected';
                logger.info('自动连接成功');
                return true;
            } else {
                logger.warn('自动连接失败');
                this.connectionStatus = 'error';
                return false;
            }
        } catch (error: any) {
            logger.error('自动连接异常:', error);
            this.connectionStatus = 'error';
            this.lastError = error.message;
            return false;
        }
    }

    disconnect(): void {
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        this.treeItems = [];
        this.currentBasePath = '/';
        
        // 清理保存监听器
        this.saveListeners.forEach(disposable => disposable.dispose());
        this.saveListeners.clear();
        
        this._onDidChangeTreeData.fire();
        
        if (this.webdavClient && this.webdavClient.isConnected) {
            this.webdavClient.disconnect();
        }
        
        logger.info('WebDAV 断开连接');
    }

    async refresh(): Promise<void> {
        logger.info('开始刷新文件列表');
        
        // 如果未连接，显示连接提示
        if (!this.isConnected) {
            logger.debug('未连接状态，显示连接提示');
            this.treeItems = [{
                id: 'connect',
                label: '点击连接 WebDAV 服务器',
                type: 'directory',
                path: '/',
                relativePath: '/',
                isDownloadable: false
            }];
            this._onDidChangeTreeData.fire();
            return;
        }
        
        if (!this.webdavClient) {
            logger.error('WebDAV客户端未初始化');
            this.treeItems = [{
                id: 'error',
                label: 'WebDAV客户端未初始化',
                type: 'directory',
                path: '/',
                relativePath: '/',
                isDownloadable: false
            }];
            this._onDidChangeTreeData.fire();
            return;
        }

        try {
            logger.info(`获取目录内容: ${this.currentBasePath}`);
            const files = await this.getRemoteFiles(this.currentBasePath);
            this.treeItems = files;
            logger.info(`获取到 ${files.length} 个文件/目录`);
            
            // 如果没有文件，显示空目录提示
            if (files.length === 0) {
                this.treeItems = [{
                    id: 'empty',
                    label: '目录为空，点击创建文件或上传文件',
                    type: 'directory',
                    path: this.currentBasePath,
                    relativePath: '/',
                    isDownloadable: false,
                    children: []
                }];
            }
        } catch (error: any) {
            logger.error('获取文件列表失败:', error);
            
            // 根据错误类型显示不同的提示
            if (error.message.includes('401') || error.message.includes('认证失败')) {
                this.disconnect();
                this.treeItems = [{
                    id: 'auth-error',
                    label: '认证失败，请重新连接',
                    type: 'directory',
                    path: '/',
                    relativePath: '/',
                    isDownloadable: false
                }];
                vscode.window.showErrorMessage('认证失败，请检查用户名和密码');
            } else if (error.message.includes('404') || error.message.includes('Not Found')) {
                this.treeItems = [{
                    id: 'path-error',
                    label: `路径 "${this.currentBasePath}" 不存在`,
                    type: 'directory',
                    path: '/',
                    relativePath: '/',
                    isDownloadable: false
                }];
                vscode.window.showWarningMessage(`路径 "${this.currentBasePath}" 不存在，请检查基础路径设置`);
            } else if (error.message.includes('timeout')) {
                this.treeItems = [{
                    id: 'timeout-error',
                    label: '请求超时，请检查网络连接',
                    type: 'directory',
                    path: '/',
                    relativePath: '/',
                    isDownloadable: false
                }];
                vscode.window.showErrorMessage('请求超时，请检查网络连接');
            } else {
                this.treeItems = [{
                    id: 'error',
                    label: '获取文件列表失败，点击刷新重试',
                    type: 'directory',
                    path: '/',
                    relativePath: '/',
                    isDownloadable: false
                }];
                vscode.window.showErrorMessage(`获取文件列表失败: ${error.message || '未知错误'}`);
            }
        }
        
        this._onDidChangeTreeData.fire();
        logger.info('刷新完成');
    }

    private async getRemoteFiles(path: string): Promise<WebDAVTreeItem[]> {
        if (!this.webdavClient) {
            throw new Error('WebDAV客户端未初始化');
        }

        logger.debug(`获取目录内容: ${path}`);
        
        try {
            const contents = await this.webdavClient.getDirectoryContents(path);
            
            // 确保 contents 是数组
            let items: any[] = [];
            if (Array.isArray(contents)) {
                items = contents;
            } else if (contents && typeof contents === 'object') {
                // 尝试从可能的数据结构中提取数组
                if (Array.isArray((contents as any).data)) {
                    items = (contents as any).data;
                } else if (Array.isArray((contents as any).items)) {
                    items = (contents as any).items;
                } else if (Array.isArray((contents as any).files)) {
                    items = (contents as any).files;
                } else {
                    // 如果是单个对象，包装成数组
                    items = [contents];
                }
            }
            
            const sortedContents = items.sort((a: any, b: any) => {
                // 目录在前，文件在后
                const aIsDir = a.type === 'directory' || (a.mime && a.mime.includes('directory'));
                const bIsDir = b.type === 'directory' || (b.mime && b.mime.includes('directory'));
                
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                
                // 按名称排序
                const aName = a.basename || a.filename || '';
                const bName = b.basename || b.filename || '';
                return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
            });
            
            return sortedContents.map((item: any) => {
                const isDirectory = item.type === 'directory' || (item.mime && item.mime.includes('directory'));
                const basename = item.basename || item.filename || '未知';
                const itemPath = path === '/' ? `/${basename}` : `${path}/${basename}`;
                
                let relativePath = itemPath;
                if (this.currentBasePath && this.currentBasePath !== '/' && itemPath.startsWith(this.currentBasePath)) {
                    relativePath = itemPath.substring(this.currentBasePath.length);
                    if (!relativePath) relativePath = '/';
                    if (relativePath !== '/' && !relativePath.startsWith('/')) {
                        relativePath = '/' + relativePath;
                    }
                }
                
                const treeItem: WebDAVTreeItem = {
                    id: itemPath,
                    label: basename,
                    type: isDirectory ? 'directory' : 'file',
                    path: itemPath,
                    relativePath: relativePath,
                    isDownloadable: !isDirectory,
                    size: item.size,
                    modified: item.lastmod ? new Date(item.lastmod) : new Date()
                };

                if (!isDirectory) {
                    const ext = basename.split('.').pop()?.toLowerCase();
                    if (ext === 'md' || ext === 'markdown') {
                        treeItem.fileType = 'markdown';
                    } else if (ext === 'txt') {
                        treeItem.fileType = 'text';
                    } else if (ext === 'json') {
                        treeItem.fileType = 'json';
                    } else if (ext === 'js') {
                        treeItem.fileType = 'javascript';
                    } else if (ext === 'ts') {
                        treeItem.fileType = 'typescript';
                    } else if (ext === 'py') {
                        treeItem.fileType = 'python';
                    } else if (ext === 'html' || ext === 'htm') {
                        treeItem.fileType = 'html';
                    } else if (ext === 'css') {
                        treeItem.fileType = 'css';
                    } else if (ext === 'xml') {
                        treeItem.fileType = 'xml';
                    } else if (ext === 'yaml' || ext === 'yml') {
                        treeItem.fileType = 'yaml';
                    }
                }

                return treeItem;
            });
        } catch (error) {
            logger.error(`获取目录 ${path} 内容失败:`, error);
            throw error;
        }
    }

    async getChildren(element?: WebDAVTreeItem): Promise<WebDAVTreeItem[]> {
        if (!element) {
            return this.treeItems;
        }
        
        // 特殊项没有子项
        if (element.id === 'connect' || element.id === 'auth-error' || 
            element.id === 'network-error' || element.id === 'error' || 
            element.id === 'empty' || element.id === 'path-error' ||
            element.id === 'timeout-error') {
            return [];
        }
        
        // 目录项获取子项
        if (element.type === 'directory' && this.isConnected && this.webdavClient) {
            try {
                return await this.getRemoteFiles(element.path);
            } catch (error) {
                logger.error(`获取子项失败: ${element.path}`, error);
                return [{
                    id: 'error-child',
                    label: '获取子项失败',
                    type: 'directory',
                    path: element.path,
                    relativePath: element.relativePath,
                    isDownloadable: false
                }];
            }
        }
        
        return [];
    }

    getTreeItem(element: WebDAVTreeItem): vscode.TreeItem {
        // 处理特殊item（连接提示等）
        if (element.id === 'connect' || element.id === 'auth-error' || 
            element.id === 'network-error' || element.id === 'error' || 
            element.id === 'empty' || element.id === 'path-error' ||
            element.id === 'timeout-error') {
            const treeItem = new vscode.TreeItem(
                element.label,
                vscode.TreeItemCollapsibleState.None
            );
            
            // 设置图标
            if (element.id === 'connect') {
                treeItem.iconPath = new vscode.ThemeIcon('cloud');
                treeItem.contextValue = 'webdav-action-item';
                treeItem.command = {
                    command: 'webdav.connect',
                    title: '连接WebDAV',
                    arguments: []
                };
            } else if (element.id === 'empty') {
                // 修复：空目录项直接执行创建文件命令
                treeItem.iconPath = new vscode.ThemeIcon('folder');
                treeItem.contextValue = 'webdav-empty-directory';
                treeItem.command = {
                    command: 'webdav.createFile',
                    title: '创建文件',
                    arguments: [{ relativePath: element.relativePath || '/' }]
                };
            } else {
                treeItem.iconPath = new vscode.ThemeIcon('warning');
                treeItem.contextValue = 'webdav-error-item';
                treeItem.command = {
                    command: 'webdav.showItemActions',
                    title: '显示操作',
                    arguments: [element]
                };
            }
            
            return treeItem;
        }

        const isDirectory = element.type === 'directory';
        const isMarkdown = element.fileType === 'markdown';

        // 创建树项
        const treeItem = new vscode.TreeItem(
            element.label,
            isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        // 为每个树项设置一个自定义命令，在点击时显示操作菜单
        treeItem.command = {
            command: 'webdav.showItemActions',
            title: '显示操作',
            arguments: [element]
        };

        // 设置图标
        if (isDirectory) {
            treeItem.iconPath = new vscode.ThemeIcon('folder');
            treeItem.contextValue = 'webdav-directory';
        } else if (isMarkdown) {
            treeItem.iconPath = new vscode.ThemeIcon('markdown');
            treeItem.contextValue = 'webdav-file webdav-markdown';
        } else {
            treeItem.iconPath = new vscode.ThemeIcon('file');
            treeItem.contextValue = 'webdav-file';
        }

        // 设置描述信息（显示在右侧）
        let description = '';
        if (element.type === 'file') {
            description = this.formatSize(element.size);
        }
        
        // 添加修改时间
        if (element.modified) {
            const now = new Date();
            const diffMs = now.getTime() - element.modified.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            let timeStr = '';
            if (diffDays === 0) {
                timeStr = '今天';
            } else if (diffDays === 1) {
                timeStr = '昨天';
            } else if (diffDays < 7) {
                timeStr = `${diffDays}天前`;
            } else if (diffDays < 30) {
                timeStr = `${Math.floor(diffDays / 7)}周前`;
            } else {
                timeStr = element.modified.toLocaleDateString();
            }
            
            if (description) description += ' · ';
            description += timeStr;
        }
        
        treeItem.description = description.trim();

        // 设置工具提示
        const tooltipLines = [
            `### ${element.label}`,
            `**路径**: ${element.path}`,
            `**类型**: ${element.type}`,
            element.modified ? `**修改时间**: ${element.modified.toLocaleString()}` : '',
            element.size ? `**大小**: ${this.formatSize(element.size)}` : '',
            '',
            '---',
            '**操作提示**:',
            '- 单击: 显示操作菜单',
            '- 使用标题栏按钮进行快速操作'
        ].filter(line => line.trim() !== '');

        treeItem.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));

        return treeItem;
    }

    getParent(element: WebDAVTreeItem): vscode.ProviderResult<WebDAVTreeItem> {
        return null;
    }

    private formatSize(bytes?: number): string {
        if (!bytes || bytes === 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    async createFile(parentPath?: any): Promise<void> {
        // 支持传入字符串或树项对象
        let actualParentPath = '/';
        
        if (typeof parentPath === 'string') {
            actualParentPath = parentPath;
        } else if (parentPath && typeof parentPath === 'object') {
            // 如果是树项对象
            const item = parentPath as WebDAVTreeItem;
            actualParentPath = item.relativePath || '/';
        } else if (parentPath && typeof parentPath === 'object' && parentPath.relativePath) {
            // 如果是包含 relativePath 的对象
            actualParentPath = parentPath.relativePath || '/';
        }
        
        const fileName = await vscode.window.showInputBox({
            prompt: '请输入文件名',
            placeHolder: '例如: newfile.md',
            validateInput: (value) => {
                if (!value.trim()) return '文件名不能为空';
                if (value.includes('/') || value.includes('\\')) return '文件名不能包含路径分隔符';
                return null;
            }
        });

        if (fileName) {
            logger.info(`创建文件: ${fileName} 在 ${actualParentPath || '根目录'}`);
            
            if (!this.webdavClient || !this.isConnected) {
                vscode.window.showErrorMessage('未连接到WebDAV服务器');
                return;
            }

            try {
                const relativePath = actualParentPath && actualParentPath !== '/' ? `${actualParentPath}/${fileName}` : fileName;
                const filePath = this.getFullPath(relativePath);
                logger.debug(`创建文件完整路径: ${filePath}`);
                
                await this.webdavClient.createFile(filePath, '');
                await this.refresh();
                vscode.window.showInformationMessage(`已创建文件: ${fileName}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`创建文件失败: ${error.message || error}`);
                logger.error('创建文件失败', error);
            }
        }
    }

    async createFolder(parentPath?: any): Promise<void> {
        // 支持传入字符串或树项对象
        let actualParentPath = '/';
        
        if (typeof parentPath === 'string') {
            actualParentPath = parentPath;
        } else if (parentPath && typeof parentPath === 'object') {
            // 如果是树项对象
            const item = parentPath as WebDAVTreeItem;
            actualParentPath = item.relativePath || '/';
        } else if (parentPath && typeof parentPath === 'object' && parentPath.relativePath) {
            // 如果是包含 relativePath 的对象
            actualParentPath = parentPath.relativePath || '/';
        }
        
        const folderName = await vscode.window.showInputBox({
            prompt: '请输入文件夹名',
            placeHolder: '例如: newfolder',
            validateInput: (value) => {
                if (!value.trim()) return '文件夹名不能为空';
                if (value.includes('/') || value.includes('\\')) return '文件夹名不能包含路径分隔符';
                return null;
            }
        });

        if (folderName) {
            logger.info(`创建文件夹: ${folderName} 在 ${actualParentPath || '根目录'}`);
            
            if (!this.webdavClient || !this.isConnected) {
                vscode.window.showErrorMessage('未连接到WebDAV服务器');
                return;
            }

            try {
                const relativePath = actualParentPath && actualParentPath !== '/' ? `${actualParentPath}/${folderName}` : folderName;
                const folderPath = this.getFullPath(relativePath);
                logger.debug(`创建文件夹完整路径: ${folderPath}`);
                
                await this.webdavClient.createDirectory(folderPath);
                await this.refresh();
                vscode.window.showInformationMessage(`已创建文件夹: ${folderName}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`创建文件夹失败: ${error.message || error}`);
                logger.error('创建文件夹失败', error);
            }
        }
    }

    async deleteItem(item: WebDAVTreeItem): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `确定要删除 "${item.label}" 吗？此操作不可恢复！`,
            { modal: true },
            '确定删除',
            '取消'
        );

        if (confirm === '确定删除') {
            logger.info(`删除 ${item.type}: ${item.path}`);
            
            if (!this.webdavClient || !this.isConnected) {
                vscode.window.showErrorMessage('未连接到WebDAV服务器');
                return;
            }

            try {
                if (item.type === 'directory') {
                    await this.webdavClient.deleteDirectory(item.path);
                } else {
                    await this.webdavClient.deleteFile(item.path);
                }
                
                await this.refresh();
                vscode.window.showInformationMessage(`已删除: ${item.label}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`删除失败: ${error.message || error}`);
                logger.error('删除失败', error);
            }
        }
    }

    async downloadItem(item: WebDAVTreeItem): Promise<void> {
        if (!this.webdavClient || !this.isConnected) {
            vscode.window.showErrorMessage('未连接到WebDAV服务器');
            return;
        }

        logger.info(`下载: ${item.path}`);
        
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在下载 ${item.label}...`,
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    logger.info('用户取消了下载');
                });

                progress.report({ increment: 0, message: '开始下载...' });
                
                const content = await this.webdavClient!.getFileContents(item.path, { format: 'text' });
                
                progress.report({ increment: 50, message: '保存到本地...' });
                
                // 使用配置中的本地同步路径
                const configCheck = await this.configManager.checkConfiguration();
                const localSyncPath = configCheck.config.localSyncPath || this.configManager.getLocalSyncPath();
                
                const relativePath = this.getRelativePath(item.path);
                const localRelativePath = relativePath === '/' ? '' : relativePath.replace(/^\//, '');
                const localPath = path.join(localSyncPath, localRelativePath);
                const dir = path.dirname(localPath);
                
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // 确保内容是字符串
                const contentStr = typeof content === 'string' ? content : String(content);
                fs.writeFileSync(localPath, contentStr, 'utf-8');
                
                progress.report({ increment: 100, message: '下载完成' });
            });

            vscode.window.showInformationMessage(`已下载: ${item.label}`, '打开文件夹').then(selection => {
                if (selection === '打开文件夹') {
                    const configCheck = this.configManager.checkConfiguration();
                    const localSyncPath = configCheck.then(c => c.config.localSyncPath) || this.configManager.getLocalSyncPath();
                    const relativePath = this.getRelativePath(item.path);
                    const localRelativePath = relativePath === '/' ? '' : relativePath.replace(/^\//, '');
                    const localPath = path.join(localSyncPath.toString(), localRelativePath);
                    const dir = path.dirname(localPath);
                    
                    const { exec } = require('child_process');
                    const platform = require('os').platform();
                    let command = '';
                    
                    if (platform === 'win32') {
                        command = `explorer "${dir}"`;
                    } else if (platform === 'darwin') {
                        command = `open "${dir}"`;
                    } else if (platform === 'linux') {
                        command = `xdg-open "${dir}"`;
                    }
                    
                    if (command) {
                        exec(command);
                    }
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`下载失败: ${error.message || error}`);
            logger.error('下载失败', error);
        }
    }

    async openFile(item: WebDAVTreeItem): Promise<void> {
        if (item.type !== 'file') return;

        logger.info(`编辑云端文件: ${item.path}, 文件名: ${item.label}`);
        
        if (!this.webdavClient || !this.fileSystemProvider) {
            vscode.window.showErrorMessage('WebDAV客户端或文件系统未初始化');
            return;
        }

        try {
            // 使用虚拟文件系统打开文件
            const uri = await this.fileSystemProvider.openFile(item.path, item.label);
            
            // 打开文档
            const document = await vscode.workspace.openTextDocument(uri);
            
            // 显示文档
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
            
            // 设置保存监听器
            this.setupSaveListener(document, uri, item.path, item.label);
            
            // 显示状态栏消息
            vscode.window.setStatusBarMessage(`正在编辑云端文件: ${item.label}`, 3000);
            
        } catch (error: any) {
            const errorMessage = error.message || String(error);
            vscode.window.showErrorMessage(`编辑文件失败: ${errorMessage}`);
            logger.error('编辑文件失败:', error);
        }
    }

    private setupSaveListener(document: vscode.TextDocument, uri: vscode.Uri, webdavPath: string, fileName: string): void {
        const uriString = uri.toString();
        
        // 移除旧的监听器（如果存在）
        const oldListener = this.saveListeners.get(uriString);
        if (oldListener) {
            oldListener.dispose();
        }
        
        // 监听文档保存事件
        const saveDisposable = vscode.workspace.onDidSaveTextDocument(async (savedDocument) => {
            if (savedDocument.uri.toString() === document.uri.toString()) {
                if (this.fileSystemProvider) {
                    try {
                        const content = savedDocument.getText();
                        await this.fileSystemProvider.saveFile(uri, content);
                        vscode.window.setStatusBarMessage(`已保存到云端: ${fileName}`, 3000);
                    } catch (error: any) {
                        const errorMessage = error.message || String(error);
                        vscode.window.showErrorMessage(`保存失败: ${errorMessage}`);
                    }
                }
            }
        });
        
        // 文档关闭时清理监听器
        const closeDisposable = vscode.workspace.onDidCloseTextDocument((closedDocument) => {
            if (closedDocument.uri.toString() === document.uri.toString()) {
                const listener = this.saveListeners.get(uriString);
                if (listener) {
                    listener.dispose();
                    this.saveListeners.delete(uriString);
                }
            }
        });
        
        // 组合两个监听器
        const combinedDisposable = vscode.Disposable.from(saveDisposable, closeDisposable);
        this.saveListeners.set(uriString, combinedDisposable);
    }

    async uploadFile(parentPath?: any): Promise<void> {
        // 支持传入字符串或树项对象
        let actualParentPath = '/';
        
        if (typeof parentPath === 'string') {
            actualParentPath = parentPath;
        } else if (parentPath && typeof parentPath === 'object') {
            // 如果是树项对象
            const item = parentPath as WebDAVTreeItem;
            actualParentPath = item.relativePath || '/';
        } else if (parentPath && typeof parentPath === 'object' && parentPath.relativePath) {
            // 如果是包含 relativePath 的对象
            actualParentPath = parentPath.relativePath || '/';
        }
        
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: '上传',
            filters: {
                '所有文件': ['*']
            }
        };

        const fileUris = await vscode.window.showOpenDialog(options);
        if (fileUris && fileUris.length > 0) {
            if (!this.webdavClient || !this.isConnected) {
                vscode.window.showErrorMessage('未连接到WebDAV服务器');
                return;
            }

            let successCount = 0;
            let failCount = 0;
            
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在上传 ${fileUris.length} 个文件...`,
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    logger.info('用户取消了上传');
                });

                for (let i = 0; i < fileUris.length; i++) {
                    const fileUri = fileUris[i];
                    const filePath = fileUri.fsPath;
                    const fileName = path.basename(filePath);
                    
                    progress.report({ 
                        increment: 100 / fileUris.length, 
                        message: `上传 ${i+1}/${fileUris.length}: ${fileName}` 
                    });
                    
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        const relativePath = actualParentPath && actualParentPath !== '/' ? `${actualParentPath}/${fileName}` : fileName;
                        const remotePath = this.getFullPath(relativePath);
                        
                        await this.webdavClient!.createFile(remotePath, content, true);
                        successCount++;
                        logger.info(`上传成功: ${fileName}`);
                    } catch (error: any) {
                        failCount++;
                        logger.error(`上传失败 ${fileName}:`, error);
                    }
                }
            });

            if (successCount > 0) {
                await this.refresh();
            }
            
            if (failCount === 0) {
                vscode.window.showInformationMessage(`成功上传 ${successCount} 个文件`);
            } else if (successCount > 0) {
                vscode.window.showWarningMessage(`上传完成: ${successCount} 个成功, ${failCount} 个失败`);
            } else {
                vscode.window.showErrorMessage(`上传失败: ${failCount} 个文件上传失败`);
            }
        }
    }

    private getFullPath(relativePath: string): string {
        if (!relativePath || relativePath === '/' || relativePath === '') {
            return this.currentBasePath;
        }
        
        const base = this.currentBasePath.endsWith('/') 
            ? this.currentBasePath.slice(0, -1) 
            : this.currentBasePath;
        
        const relative = relativePath.startsWith('/') 
            ? relativePath.slice(1) 
            : relativePath;
        
        return `${base}/${relative}`;
    }

    private getRelativePath(fullPath: string): string {
        if (this.currentBasePath === '/' || !fullPath.startsWith(this.currentBasePath)) {
            return fullPath;
        }
        
        let relative = fullPath.substring(this.currentBasePath.length);
        if (!relative) relative = '/';
        if (relative !== '/' && !relative.startsWith('/')) {
            relative = '/' + relative;
        }
        
        return relative;
    }

    public getConnectionStatus(): string {
        return this.connectionStatus;
    }

    public getLastError(): string | null {
        return this.lastError;
    }

    public isConnectedToServer(): boolean {
        return this.isConnected;
    }
}