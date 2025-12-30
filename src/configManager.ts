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
    private static instance: ConfigManager;

    private constructor() {
        logger.info('ConfigManager初始化开始');
        logger.info('ConfigManager初始化完成');
    }

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    // 直接从VS Code设置获取配置（不使用缓存）
    async loadConfig(): Promise<WebDAVConfig> {
        try {
            logger.info('开始从VS Code设置加载WebDAV配置...');
            
            // 直接从VS Code设置加载（不使用缓存）
            const vscodeConfig = vscode.workspace.getConfiguration('webdav');
            
            // 获取所有配置项
            const serverUrl = vscodeConfig.get<string>('serverUrl', '');
            const username = vscodeConfig.get<string>('username', '');
            const password = vscodeConfig.get<string>('password', '');
            const basePath = vscodeConfig.get<string>('basePath', '/');
            const useHttps = vscodeConfig.get<boolean>('useHttps', true);
            const repositoryName = vscodeConfig.get<string>('repositoryName', 'WebDAV Repository');
            const localSyncPath = vscodeConfig.get<string>('localSyncPath', '');
            const autoSync = vscodeConfig.get<boolean>('autoSync', true);
            const syncOnSave = vscodeConfig.get<boolean>('syncOnSave', true);
            
            logger.info('从VS Code设置加载的配置:', {
                serverUrl: serverUrl || '空',
                username: username || '空',
                password: password ? '已设置' : '未设置',
                basePath,
                useHttps,
                repositoryName,
                localSyncPath: localSyncPath || '空',
                autoSync,
                syncOnSave
            });
            
            // 解析本地路径
            const resolvedLocalPath = this.resolveLocalPath(localSyncPath);
            
            const config: WebDAVConfig = {
                serverUrl: serverUrl ? serverUrl.trim() : '',
                username: username ? username.trim() : '',
                password: password ? password.trim() : '',
                basePath: basePath ? basePath.trim() : '/',
                useHttps,
                repositoryName: repositoryName ? repositoryName.trim() : 'WebDAV Repository',
                localSyncPath: resolvedLocalPath,
                autoSync,
                syncOnSave
            };
            
            logger.info('配置加载完成');
            return config;
            
        } catch (error) {
            logger.error('从VS Code设置加载配置失败', error);
            // 返回默认配置
            return this.getDefaultConfig();
        }
    }

    async saveConfig(config: WebDAVConfig): Promise<void> {
        try {
            logger.info('开始保存WebDAV配置到VS Code设置...');
            
            // 清理配置
            const cleanConfig = {
                serverUrl: (config.serverUrl || '').trim(),
                username: (config.username || '').trim(),
                password: (config.password || '').trim(),
                basePath: (config.basePath || '/').trim(),
                useHttps: config.useHttps,
                repositoryName: (config.repositoryName || 'WebDAV Repository').trim(),
                localSyncPath: this.resolveLocalPath(config.localSyncPath),
                autoSync: config.autoSync,
                syncOnSave: config.syncOnSave
            };
            
            // 保存到VS Code设置
            const vscodeConfig = vscode.workspace.getConfiguration('webdav');
            
            // 使用异步更新所有设置
            await Promise.all([
                vscodeConfig.update('serverUrl', cleanConfig.serverUrl, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('username', cleanConfig.username, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('password', cleanConfig.password, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('basePath', cleanConfig.basePath, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('useHttps', cleanConfig.useHttps, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('repositoryName', cleanConfig.repositoryName, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('localSyncPath', cleanConfig.localSyncPath, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('autoSync', cleanConfig.autoSync, vscode.ConfigurationTarget.Global),
                vscodeConfig.update('syncOnSave', cleanConfig.syncOnSave, vscode.ConfigurationTarget.Global)
            ]);
            
            logger.info('配置已保存到VS Code设置');
            
        } catch (error) {
            logger.error('保存配置到VS Code设置失败', error);
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
        if (resolvedPath.includes('${webdav.repositoryName}')) {
            const vscodeConfig = vscode.workspace.getConfiguration('webdav');
            const repositoryName = vscodeConfig.get<string>('repositoryName', 'WebDAV Repository');
            resolvedPath = resolvedPath.replace(/\$\{webdav.repositoryName\}/g, repositoryName);
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
        // 每次都从VS Code设置获取最新配置
        const vscodeConfig = vscode.workspace.getConfiguration('webdav');
        
        return {
            serverUrl: vscodeConfig.get<string>('serverUrl', '') || '',
            username: vscodeConfig.get<string>('username', '') || '',
            password: vscodeConfig.get<string>('password', '') || '',
            basePath: vscodeConfig.get<string>('basePath', '/') || '/',
            useHttps: vscodeConfig.get<boolean>('useHttps', true),
            repositoryName: vscodeConfig.get<string>('repositoryName', 'WebDAV Repository') || 'WebDAV Repository',
            localSyncPath: this.resolveLocalPath(vscodeConfig.get<string>('localSyncPath', '')),
            autoSync: vscodeConfig.get<boolean>('autoSync', true),
            syncOnSave: vscodeConfig.get<boolean>('syncOnSave', true)
        };
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

    // 新增：检查配置是否完整
    public async checkConfiguration(): Promise<{ isValid: boolean; missingFields: string[]; config: WebDAVConfig }> {
        const config = await this.loadConfig();
        const missingFields: string[] = [];
        
        if (!config.serverUrl || config.serverUrl.trim() === '') {
            missingFields.push('服务器地址');
        }
        if (!config.username || config.username.trim() === '') {
            missingFields.push('用户名');
        }
        if (!config.password || config.password.trim() === '') {
            missingFields.push('密码');
        }
        
        return {
            isValid: missingFields.length === 0,
            missingFields,
            config
        };
    }
}