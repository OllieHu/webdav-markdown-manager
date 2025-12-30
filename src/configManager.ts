
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

    // 直接从VS Code用户设置获取配置（不使用工作区配置）
    async loadConfig(): Promise<WebDAVConfig> {
        try {
            logger.info('开始从VS Code用户设置加载WebDAV配置...');
            
            // 从VS Code用户设置加载（只读取用户配置）
            const config = vscode.workspace.getConfiguration('webdav');
            
            // 使用inspect方法获取用户配置，避免工作区配置覆盖
            const getGlobalValue = <T>(key: string, defaultValue: T): T => {
                const inspected = config.inspect(key);
                if (inspected && inspected.globalValue !== undefined) {
                    return inspected.globalValue as T;
                }
                return defaultValue;
            };
            
            // 获取所有配置项（只从用户配置）
            const serverUrl = getGlobalValue<string>('serverUrl', '');
            const username = getGlobalValue<string>('username', '');
            const password = getGlobalValue<string>('password', '');
            const basePath = getGlobalValue<string>('basePath', '/');
            const useHttps = getGlobalValue<boolean>('useHttps', true);
            const repositoryName = getGlobalValue<string>('repositoryName', 'WebDAV Repository');
            const localSyncPath = getGlobalValue<string>('localSyncPath', '');
            const autoSync = getGlobalValue<boolean>('autoSync', true);
            const syncOnSave = getGlobalValue<boolean>('syncOnSave', true);
            
            const resolvedLocalPath = this.resolveLocalPath(localSyncPath);
            
            logger.info('从VS Code用户设置加载的配置详情:', {
                serverUrl: serverUrl || '空',
                username: username || '空',
                password: password ? '已设置' : '未设置',
                basePath,
                useHttps,
                repositoryName,
                localSyncPath: localSyncPath || '空',
                rawLocalSyncPath: localSyncPath, // 添加原始路径
                resolvedLocalPath: resolvedLocalPath, // 添加解析后路径
                autoSync,
                syncOnSave
            });
            
            const configResult: WebDAVConfig = {
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
            
            logger.info('配置加载完成:', configResult);
            return configResult;
            
        } catch (error) {
            logger.error('从VS Code用户设置加载配置失败', error);
            // 返回默认配置
            return this.getDefaultConfig();
        }
    }

    async saveConfig(config: WebDAVConfig): Promise<void> {
        try {
            logger.info('开始保存WebDAV配置到VS Code用户设置...');
            
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
            
            // 保存到VS Code用户设置
            const vscodeConfig = vscode.workspace.getConfiguration('webdav');
            
            // 使用异步更新所有设置 - 保存到用户设置
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
            
            logger.info('配置已保存到VS Code用户设置');
            
        } catch (error) {
            logger.error('保存配置到VS Code用户设置失败', error);
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
        
        logger.debug('默认配置获取完成:', defaultConfig);
        return defaultConfig;
    }

    public resolveLocalPath(localPathTemplate: string): string {
        if (!localPathTemplate || localPathTemplate.trim() === '') {
            const defaultConfig = this.getDefaultConfig();
            logger.debug(`使用默认路径: ${defaultConfig.localSyncPath}`);
            return defaultConfig.localSyncPath;
        }
        
        logger.debug(`解析本地路径模板: ${localPathTemplate}`);
        
        // 获取用户配置中的repositoryName
        const vscodeConfig = vscode.workspace.getConfiguration('webdav');
        const repositoryName = this.getGlobalConfigValue<string>('repositoryName', 'WebDAV Repository');
        
        let resolvedPath = localPathTemplate;
        
        // 先替换 repositoryName
        if (resolvedPath.includes('${webdav.repositoryName}')) {
            resolvedPath = resolvedPath.replace(/\$\{webdav.repositoryName\}/g, repositoryName);
            logger.debug(`替换 repositoryName 后: ${resolvedPath}`);
        }
        
        // 再替换其他变量
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const userHome = os.homedir();
        const documentsDir = this.getDocumentsDirectory();
        
        if (workspaceFolder && resolvedPath.includes('${workspaceFolder}')) {
            resolvedPath = resolvedPath.replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath);
            logger.debug(`替换 workspaceFolder 后: ${resolvedPath}`);
        }
        if (resolvedPath.includes('${userHome}')) {
            resolvedPath = resolvedPath.replace(/\$\{userHome\}/g, userHome);
            logger.debug(`替换 userHome 后: ${resolvedPath}`);
        }
        if (resolvedPath.includes('${documents}')) {
            resolvedPath = resolvedPath.replace(/\$\{documents\}/g, documentsDir);
            logger.debug(`替换 documents 后: ${resolvedPath}`);
        }
        
        // 确保路径是绝对路径
        if (!path.isAbsolute(resolvedPath)) {
            // 如果没有工作区，使用用户主目录
            const baseDir = workspaceFolder ? workspaceFolder.uri.fsPath : userHome;
            resolvedPath = path.join(baseDir, resolvedPath);
            logger.debug(`转换为绝对路径: ${resolvedPath}`);
        }
        
        // 标准化路径
        resolvedPath = path.normalize(resolvedPath);
        
        logger.debug(`最终解析的路径: ${resolvedPath}`);
        return resolvedPath;
    }

    // 辅助方法：获取用户配置值
    private getGlobalConfigValue<T>(key: string, defaultValue: T): T {
        const config = vscode.workspace.getConfiguration('webdav');
        const inspected = config.inspect(key);
        if (inspected && inspected.globalValue !== undefined) {
            return inspected.globalValue as T;
        }
        return defaultValue;
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
        // 每次都从VS Code用户设置获取最新配置
        const config = vscode.workspace.getConfiguration('webdav');
        
        // 使用inspect方法获取用户配置
        const getGlobalValue = <T>(key: string, defaultValue: T): T => {
            const inspected = config.inspect(key);
            if (inspected && inspected.globalValue !== undefined) {
                return inspected.globalValue as T;
            }
            return defaultValue;
        };
        
        const webDAVConfig: WebDAVConfig = {
            serverUrl: getGlobalValue<string>('serverUrl', '') || '',
            username: getGlobalValue<string>('username', '') || '',
            password: getGlobalValue<string>('password', '') || '',
            basePath: getGlobalValue<string>('basePath', '/') || '/',
            useHttps: getGlobalValue<boolean>('useHttps', true),
            repositoryName: getGlobalValue<string>('repositoryName', 'WebDAV Repository') || 'WebDAV Repository',
            localSyncPath: this.resolveLocalPath(getGlobalValue<string>('localSyncPath', '')),
            autoSync: getGlobalValue<boolean>('autoSync', true),
            syncOnSave: getGlobalValue<boolean>('syncOnSave', true)
        };
        
        logger.debug('获取当前配置:', webDAVConfig);
        return webDAVConfig;
    }

    public ensureLocalSyncFolder(repositoryName?: string): string {
        const syncPath = this.getLocalSyncPath(repositoryName);
        try {
            if (!fs.existsSync(syncPath)) {
                fs.mkdirSync(syncPath, { recursive: true });
                logger.info(`创建本地同步文件夹: ${syncPath}`);
            }
        } catch (error) {
            logger.error('创建本地同步文件夹失败', error);
        }
        return syncPath;
    }

    // 修改：检查配置是否完整（放宽密码检查）
    public async checkConfiguration(): Promise<{ isValid: boolean; missingFields: string[]; config: WebDAVConfig }> {
        const config = await this.loadConfig();
        const missingFields: string[] = [];
        
        if (!config.serverUrl || config.serverUrl.trim() === '') {
            missingFields.push('服务器地址');
        }
        if (!config.username || config.username.trim() === '') {
            missingFields.push('用户名');
        }
        // 放宽密码检查，有些服务器可能允许空密码
        // if (!config.password || config.password.trim() === '') {
        //     missingFields.push('密码');
        // }
        
        const isValid = missingFields.length === 0;
        logger.info(`配置检查结果: ${isValid ? '通过' : '不通过'}, 缺失字段: ${missingFields.join(', ')}`);
        
        return {
            isValid,
            missingFields,
            config
        };
    }
}
