
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const logger = {
    info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
    debug: (msg: string, ...args: any[]) => console.log(`[DEBUG] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args)
};

export interface WebDAVConfig {
    serverUrl: string;
    username: string;
    password: string;
    basePath: string;
    useHttps: boolean;
    repositoryName: string;
    localSyncPath: string;
    autoSync: boolean;
    syncOnSave: boolean;
}

export class ConfigManager {
    private static readonly CONFIG_FILE = 'webdav-config.json';
    private configPath: string;
    private _currentConfig: WebDAVConfig | null = null;
    private configLoadPromise: Promise<WebDAVConfig> | null = null;

    constructor() {
        logger.info('ConfigManager初始化开始');
        this.configPath = this.getConfigFilePath();
        logger.info(`配置路径: ${this.configPath}`);
        logger.info('ConfigManager初始化完成');
    }

    private getConfigFilePath(): string {
        const homeDir = os.homedir();
        const configDir = path.join(homeDir, '.vscode-webdav');
        
        logger.debug(`用户主目录: ${homeDir}`);
        logger.debug(`配置目录: ${configDir}`);
        
        if (!fs.existsSync(configDir)) {
            logger.info(`创建配置目录: ${configDir}`);
            try {
                fs.mkdirSync(configDir, { recursive: true });
                logger.info('配置目录创建成功');
            } catch (error) {
                logger.error('创建配置目录失败', error);
            }
        }

        return path.join(configDir, ConfigManager.CONFIG_FILE);
    }

    async loadConfig(): Promise<WebDAVConfig> {
        // 如果正在加载，等待加载完成
        if (this.configLoadPromise) {
            logger.debug('配置正在加载中，等待完成...');
            return await this.configLoadPromise;
        }

        // 如果已经加载过，直接返回缓存
        if (this._currentConfig) {
            logger.debug('使用缓存的配置');
            return this._currentConfig;
        }

        this.configLoadPromise = this.loadConfigInternal();
        try {
            const config = await this.configLoadPromise;
            this._currentConfig = config;
            return config;
        } finally {
            this.configLoadPromise = null;
        }
    }

    private async loadConfigInternal(): Promise<WebDAVConfig> {
        try {
            logger.info('开始加载WebDAV配置...');
            
            // 从VS Code设置加载
            const vscodeConfig = vscode.workspace.getConfiguration('webdav');
            const defaultConfig = this.getDefaultConfig();

            let config: WebDAVConfig = {
                serverUrl: String(vscodeConfig.get('serverUrl') || defaultConfig.serverUrl || '').trim(),
                username: String(vscodeConfig.get('username') || defaultConfig.username || '').trim(),
                password: String(vscodeConfig.get('password') || defaultConfig.password || '').trim(),
                basePath: String(vscodeConfig.get('basePath') || defaultConfig.basePath || '/').trim(),
                useHttps: Boolean(vscodeConfig.get('useHttps', defaultConfig.useHttps)),
                repositoryName: String(vscodeConfig.get('repositoryName') || defaultConfig.repositoryName || 'WebDAV Repository').trim(),
                localSyncPath: this.resolveLocalPath(String(vscodeConfig.get('localSyncPath') || defaultConfig.localSyncPath)),
                autoSync: Boolean(vscodeConfig.get('autoSync', defaultConfig.autoSync)),
                syncOnSave: Boolean(vscodeConfig.get('syncOnSave', defaultConfig.syncOnSave))
            };

            logger.info('从VS Code加载的配置完成');
            
            // 如果VS Code设置为空，尝试从持久化文件加载
            const fileExists = fs.existsSync(this.configPath);
            logger.debug(`检查配置文件是否存在: ${this.configPath}, 存在: ${fileExists}`);
            
            if ((!config.serverUrl || !config.username || !config.password) && fileExists) {
                logger.info('尝试从配置文件加载...');
                try {
                    const fileContent = fs.readFileSync(this.configPath, 'utf8');
                    const persistentConfig = JSON.parse(fileContent) as WebDAVConfig;
                    
                    // 仅当VS Code设置中没有相应值时，使用文件中的值
                    if (!config.serverUrl && persistentConfig.serverUrl) {
                        config.serverUrl = String(persistentConfig.serverUrl).trim();
                    }
                    if (!config.username && persistentConfig.username) {
                        config.username = String(persistentConfig.username).trim();
                    }
                    if (!config.password && persistentConfig.password) {
                        config.password = String(persistentConfig.password).trim();
                    }
                    if (!config.basePath && persistentConfig.basePath) {
                        config.basePath = String(persistentConfig.basePath).trim();
                    }
                    
                    logger.info('成功从文件加载配置');
                } catch (fileError) {
                    logger.error('从文件加载配置失败', fileError);
                }
            }

            logger.info('配置加载完成', {
                serverUrl: config.serverUrl ? `${config.serverUrl.substring(0, 20)}...` : '空',
                username: config.username ? `${config.username.substring(0, 5)}...` : '空',
                basePath: config.basePath,
                hasPassword: !!config.password
            });

            return config;
        } catch (error) {
            logger.error('加载配置失败', error);
            const defaultConfig = this.getDefaultConfig();
            return defaultConfig;
        }
    }

    async saveConfig(config: WebDAVConfig): Promise<void> {
        try {
            logger.info('开始保存WebDAV配置...');
            
            // 清理配置
            const cleanConfig = {
                ...config,
                serverUrl: (config.serverUrl || '').trim(),
                username: (config.username || '').trim(),
                password: (config.password || '').trim(),
                basePath: (config.basePath || '/').trim(),
                repositoryName: (config.repositoryName || 'WebDAV Repository').trim()
            };

            // 保存到VS Code设置
            const vscodeConfig = vscode.workspace.getConfiguration('webdav');
            
            await vscodeConfig.update('serverUrl', cleanConfig.serverUrl, vscode.ConfigurationTarget.Global);
            await vscodeConfig.update('username', cleanConfig.username, vscode.ConfigurationTarget.Global);
            await vscodeConfig.update('password', cleanConfig.password, vscode.ConfigurationTarget.Global);
            await vscodeConfig.update('basePath', cleanConfig.basePath, vscode.ConfigurationTarget.Global);
            await vscodeConfig.update('useHttps', cleanConfig.useHttps, vscode.ConfigurationTarget.Global);
            await vscodeConfig.update('repositoryName', cleanConfig.repositoryName, vscode.ConfigurationTarget.Global);
            
            const resolvedLocalPath = this.resolveLocalPath(cleanConfig.localSyncPath);
            await vscodeConfig.update('localSyncPath', resolvedLocalPath, vscode.ConfigurationTarget.Global);
            
            await vscodeConfig.update('autoSync', cleanConfig.autoSync, vscode.ConfigurationTarget.Global);
            await vscodeConfig.update('syncOnSave', cleanConfig.syncOnSave, vscode.ConfigurationTarget.Global);

            logger.info('VS Code设置更新完成');

            // 持久化到文件（不保存密码）
            const configWithoutPassword = { ...cleanConfig, password: '' };
            try {
                fs.writeFileSync(this.configPath, JSON.stringify(configWithoutPassword, null, 2));
                logger.info(`配置已保存到文件: ${this.configPath}`);
            } catch (fileError) {
                logger.error('保存配置文件失败', fileError);
            }
            
            this._currentConfig = cleanConfig;
            
            logger.info('配置保存成功');
        } catch (error) {
            logger.error('保存配置失败', error);
            throw new Error(`保存配置失败: ${error}`);
        }
    }

    private getDefaultConfig(): WebDAVConfig {
        logger.debug('获取默认配置');
        const documentsDir = this.getDocumentsDirectory();
        const repositoryName = 'WebDAV Repository';
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        let localSyncPath: string;
        
        if (workspaceFolder) {
            localSyncPath = path.join(workspaceFolder.uri.fsPath, 'webdav-sync', repositoryName);
        } else {
            localSyncPath = path.join(documentsDir, 'WebDAV-Sync', repositoryName);
        }
        
        const defaultConfig = {
            serverUrl: '',
            username: '',
            password: '',
            basePath: '/',
            useHttps: true,
            repositoryName: repositoryName,
            localSyncPath: localSyncPath,
            autoSync: true,
            syncOnSave: true
        };
        
        logger.debug('默认配置获取完成');
        return defaultConfig;
    }

    public resolveLocalPath(localPathTemplate: string): string {
        if (!localPathTemplate || localPathTemplate.trim() === '') {
            return this.getDefaultConfig().localSyncPath;
        }
        
        logger.debug(`解析本地路径模板: ${localPathTemplate}`);
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const documentsDir = this.getDocumentsDirectory();
        
        let resolvedPath = localPathTemplate;
        
        // 替换变量
        if (workspaceFolder && resolvedPath.includes('${workspaceFolder}')) {
            resolvedPath = resolvedPath.replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath);
        }
        if (resolvedPath.includes('${userHome}')) {
            const userHome = os.homedir();
            resolvedPath = resolvedPath.replace(/\$\{userHome\}/g, userHome);
        }
        if (resolvedPath.includes('${documents}')) {
            resolvedPath = resolvedPath.replace(/\$\{documents\}/g, documentsDir);
        }
        
        // 确保路径是绝对路径
        if (!path.isAbsolute(resolvedPath)) {
            const baseDir = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();
            resolvedPath = path.join(baseDir, resolvedPath);
        }
        
        // 标准化路径
        resolvedPath = path.normalize(resolvedPath);
        
        // 确保路径存在
        try {
            if (!fs.existsSync(resolvedPath)) {
                fs.mkdirSync(resolvedPath, { recursive: true });
                logger.debug(`创建目录: ${resolvedPath}`);
            }
        } catch (error) {
            logger.error('创建目录失败', error);
        }
        
        logger.debug(`最终解析的路径: ${resolvedPath}`);
        return resolvedPath;
    }

    public getDocumentsDirectory(): string {
        const platform = os.platform();
        const homeDir = os.homedir();
        let documentsDir: string;

        switch (platform) {
            case 'win32':
                try {
                    const userProfile = process.env.USERPROFILE || homeDir;
                    const possiblePaths = [
                        path.join(userProfile, 'Documents'),
                        path.join(userProfile, 'My Documents'),
                        path.join(homeDir, 'Documents'),
                        path.join(homeDir, 'My Documents')
                    ];
                    
                    documentsDir = path.join(userProfile, 'Documents');
                    
                    for (const docPath of possiblePaths) {
                        if (fs.existsSync(docPath)) {
                            documentsDir = docPath;
                            break;
                        }
                    }
                    
                    if (!documentsDir) {
                        documentsDir = path.join(homeDir, 'Documents');
                    }
                } catch (error) {
                    documentsDir = path.join(homeDir, 'Documents');
                }
                break;
            case 'darwin':
                documentsDir = path.join(homeDir, 'Documents');
                break;
            case 'linux':
                const possiblePaths = [
                    path.join(homeDir, 'Documents'),
                    path.join(homeDir, '文档'),
                    path.join(homeDir, 'My Documents')
                ];
                
                documentsDir = path.join(homeDir, 'Documents');
                
                for (const docPath of possiblePaths) {
                    if (fs.existsSync(docPath)) {
                        documentsDir = docPath;
                        break;
                    }
                }
                break;
            default:
                documentsDir = path.join(homeDir, 'Documents');
                break;
        }

        try {
            if (!fs.existsSync(documentsDir)) {
                fs.mkdirSync(documentsDir, { recursive: true });
            }
        } catch (error) {
            return homeDir;
        }

        return documentsDir;
    }

    getLocalSyncPath(repositoryName?: string): string {
        const config = this.getCurrentConfig();
        if (config.localSyncPath && config.localSyncPath.trim() !== '') {
            return config.localSyncPath;
        }
        
        const documentsDir = this.getDocumentsDirectory();
        const repoName = repositoryName || config.repositoryName || 'WebDAV Repository';
        const syncPath = path.join(documentsDir, 'WebDAV-Sync', repoName);
        return syncPath;
    }

    async openDocumentsFolder(): Promise<void> {
        try {
            const documentsDir = this.getDocumentsDirectory();
            
            const platform = os.platform();
            let command: string;

            switch (platform) {
                case 'win32':
                    command = `explorer "${documentsDir}"`;
                    break;
                case 'darwin':
                    command = `open "${documentsDir}"`;
                    break;
                case 'linux':
                    command = `xdg-open "${documentsDir}"`;
                    break;
                default:
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(documentsDir));
                    return;
            }

            require('child_process').exec(command);
        } catch (error) {
            vscode.window.showErrorMessage('打开Documents文件夹失败');
        }
    }

    public getCurrentConfig(): WebDAVConfig {
        if (!this._currentConfig) {
            return this.getDefaultConfig();
        }
        return { ...this._currentConfig };
    }

    public ensureLocalSyncFolder(repositoryName?: string): string {
        const syncPath = this.getLocalSyncPath(repositoryName);
        try {
            if (!fs.existsSync(syncPath)) {
                fs.mkdirSync(syncPath, { recursive: true });
            }
        } catch (error) {
            logger.error('创建本地同步文件夹失败', error);
        }
        return syncPath;
    }
}
