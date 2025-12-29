// syncEditorManager.ts - 向后兼容的实现
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MyWebDAVClient } from './webdavClient';
import { WebDAVFileSystemProvider } from './webdavFileSystemProvider';

// 临时logger
const tempLogger = {
    info: (message: string, ...args: any[]) => console.log(`[INFO][Editor] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[ERROR][Editor] ${message}`, ...args),
    debug: (message: string, ...args: any[]) => console.log(`[DEBUG][Editor] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[WARN][Editor] ${message}`, ...args)
};

export class WebDAVFileManager {
    private static instance: WebDAVFileManager;
    private webdavClient: MyWebDAVClient | null = null;
    private fileSystemProvider: WebDAVFileSystemProvider | null = null;
    private configManager: any;

    private constructor() {
        tempLogger.info('WebDAV文件管理器已初始化（向后兼容模式）');
    }

    public static getInstance(): WebDAVFileManager {
        if (!WebDAVFileManager.instance) {
            WebDAVFileManager.instance = new WebDAVFileManager();
        }
        return WebDAVFileManager.instance;
    }

    public setWebDAVClient(client: MyWebDAVClient): void {
        this.webdavClient = client;
        tempLogger.debug('WebDAV客户端已设置');
    }
    
    public setFileSystemProvider(provider: WebDAVFileSystemProvider): void {
        this.fileSystemProvider = provider;
        tempLogger.debug('文件系统提供程序已设置');
    }

    public setConfigManager(configManager: any): void {
        this.configManager = configManager;
    }

    // 向后兼容的方法
    public async editFile(webdavPath: string, fileName: string, fileType?: string): Promise<vscode.TextEditor | null> {
        if (!this.fileSystemProvider) {
            throw new Error('文件系统提供程序未初始化');
        }
        
        try {
            // 使用虚拟文件系统打开文件
            const uri = await this.fileSystemProvider.openFile(webdavPath, fileName);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
            
            tempLogger.info(`开始编辑云端文件: ${fileName}（向后兼容模式）`);
            return editor;
            
        } catch (error) {
            tempLogger.error(`编辑云端文件失败: ${webdavPath}`, error);
            throw error;
        }
    }

    // 其他向后兼容的方法...
    public async saveFile(webdavPath: string): Promise<boolean> {
        if (!this.fileSystemProvider) {
            return false;
        }
        
        // 查找虚拟文件
        const files = this.fileSystemProvider.getOpenFiles();
        const virtualFile = files.find(f => f.webdavPath === webdavPath);
        
        if (!virtualFile) {
            return false;
        }
        
        try {
            const uri = this.fileSystemProvider.createVirtualFileUri(webdavPath, virtualFile.fileName);
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
            
            if (document) {
                const content = document.getText();
                await this.fileSystemProvider.saveFile(uri, content);
                return true;
            }
        } catch (error) {
            tempLogger.error(`保存文件失败: ${webdavPath}`, error);
        }
        
        return false;
    }
    
    public async saveAll(): Promise<void> {
        if (!this.fileSystemProvider) {
            return;
        }
        
        try {
            await this.fileSystemProvider.saveAll();
        } catch (error) {
            tempLogger.error('保存所有文件失败:', error);
            throw error;
        }
    }
    
    public closeAll(): void {
        if (this.fileSystemProvider) {
            this.fileSystemProvider.closeAll();
        }
    }
}