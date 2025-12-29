import * as vscode from 'vscode';
import { ConfigManager, WebDAVConfig } from './configManager';

const tempLogger = {
    info: (message: string, ...args: any[]) => console.log(`[INFO][Settings] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[ERROR][Settings] ${message}`, ...args),
    debug: (message: string, ...args: any[]) => console.log(`[DEBUG][Settings] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[WARN][Settings] ${message}`, ...args)
};

export class SettingsWebviewProvider {
    private _configManager: ConfigManager;

    constructor(configManager: ConfigManager) {
        this._configManager = configManager;
        tempLogger.info('SettingsWebviewProvider已初始化');
    }

    // 显示设置页面
    public async showSettings(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
    }

    // 加载配置
    public async loadConfig(): Promise<WebDAVConfig> {
        return await this._configManager.loadConfig();
    }

    // 保存配置
    public async saveConfig(config: WebDAVConfig): Promise<void> {
        await this._configManager.saveConfig(config);
    }
}