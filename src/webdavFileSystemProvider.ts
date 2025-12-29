import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MyWebDAVClient } from './webdavClient';
import { logger } from './logger';

export interface VirtualFile {
    webdavPath: string;
    fileName: string;
    content: Uint8Array;
    mtime: number;
    ctime: number;
    size: number;
    isDirty: boolean;
}

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;
    
    private webdavClient: MyWebDAVClient | null = null;
    private virtualFiles: Map<string, VirtualFile> = new Map();
    private tempDir: string;
    private configManager: any;
    
    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'vscode-webdav-fs');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        logger.info(`虚拟文件系统临时目录: ${this.tempDir}`);
    }
    
    public setWebDAVClient(client: MyWebDAVClient): void {
        this.webdavClient = client;
    }
    
    public setConfigManager(configManager: any): void {
        this.configManager = configManager;
    }
    
    public createVirtualFileUri(webdavPath: string, fileName: string): vscode.Uri {
        const encodedPath = encodeURIComponent(webdavPath);
        const uri = vscode.Uri.parse(`webdav-file://${encodedPath}/${fileName}`);
        logger.debug(`创建虚拟文件URI: ${uri.toString()}`);
        return uri;
    }
    
    public async openFile(webdavPath: string, fileName: string): Promise<vscode.Uri> {
        if (!this.webdavClient) {
            throw new Error('WebDAV客户端未初始化');
        }
        
        logger.info(`打开云端文件: ${webdavPath}, 文件名: ${fileName}`);
        
        try {
            let content = '';
            try {
                const fileContent = await this.webdavClient.getFileContents(webdavPath, { format: 'text' });
                content = typeof fileContent === 'string' ? fileContent : String(fileContent);
                logger.debug(`获取云端文件内容成功，长度: ${content.length}`);
            } catch (error: any) {
                const errorMessage = error.message || String(error);
                if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
                    logger.info(`云端文件不存在，将创建新文件: ${fileName}`);
                    content = '';
                } else {
                    throw error;
                }
            }
            
            const uri = this.createVirtualFileUri(webdavPath, fileName);
            const uriString = uri.toString();
            
            const encoder = new TextEncoder();
            const now = Date.now();
            this.virtualFiles.set(uriString, {
                webdavPath,
                fileName,
                content: encoder.encode(content),
                mtime: now,
                ctime: now,
                size: content.length,
                isDirty: false
            });
            
            const cachePath = this.getCachePath(uri);
            fs.writeFileSync(cachePath, content, 'utf-8');
            
            logger.info(`虚拟文件已创建: ${fileName}`);
            return uri;
            
        } catch (error) {
            logger.error(`打开云端文件失败: ${webdavPath}`, error);
            throw error;
        }
    }
    
    public async saveFile(uri: vscode.Uri, content: string): Promise<void> {
        const virtualFile = this.virtualFiles.get(uri.toString());
        if (!virtualFile || !this.webdavClient) {
            throw new Error('文件未找到或WebDAV客户端未初始化');
        }
        
        logger.info(`保存文件到云端: ${virtualFile.webdavPath}, 文件名: ${virtualFile.fileName}`);
        
        try {
            await this.webdavClient.createFile(virtualFile.webdavPath, content, true);
            
            const encoder = new TextEncoder();
            virtualFile.content = encoder.encode(content);
            virtualFile.mtime = Date.now();
            virtualFile.size = content.length;
            virtualFile.isDirty = false;
            
            const cachePath = this.getCachePath(uri);
            fs.writeFileSync(cachePath, content, 'utf-8');
            
            this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            
            logger.info(`文件已保存到云端: ${virtualFile.fileName}`);
            
        } catch (error) {
            logger.error('保存到云端失败:', error);
            throw error;
        }
    }
    
    private getCachePath(uri: vscode.Uri): string {
        const uriString = uri.toString();
        const hash = this.hashString(uriString);
        const cacheFileName = `cache_${hash}.tmp`;
        return path.join(this.tempDir, cacheFileName);
    }
    
    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).substring(0, 8);
    }
    
    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return new vscode.Disposable(() => {
            // 清理资源
        });
    }
    
    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        const virtualFile = this.virtualFiles.get(uri.toString());
        if (!virtualFile) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        
        return {
            type: vscode.FileType.File,
            ctime: virtualFile.ctime,
            mtime: virtualFile.mtime,
            size: virtualFile.size
        };
    }
    
    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        throw vscode.FileSystemError.NoPermissions(uri);
    }
    
    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions(uri);
    }
    
    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        const virtualFile = this.virtualFiles.get(uri.toString());
        if (!virtualFile) {
            try {
                const cachePath = this.getCachePath(uri);
                if (fs.existsSync(cachePath)) {
                    const content = fs.readFileSync(cachePath, 'utf-8');
                    const encoder = new TextEncoder();
                    return encoder.encode(content);
                }
            } catch (error) {
                // 忽略缓存读取错误
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        
        return virtualFile.content;
    }
    
    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void | Thenable<void> {
        const virtualFile = this.virtualFiles.get(uri.toString());
        
        if (!virtualFile && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        
        if (virtualFile && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        
        const now = Date.now();
        if (!virtualFile && options.create) {
            const pathParts = uri.path.split('/');
            const fileName = pathParts[pathParts.length - 1];
            const webdavPath = decodeURIComponent(uri.authority);
            
            const newVirtualFile: VirtualFile = {
                webdavPath,
                fileName,
                content,
                mtime: now,
                ctime: now,
                size: content.length,
                isDirty: true
            };
            
            this.virtualFiles.set(uri.toString(), newVirtualFile);
            logger.info(`创建新虚拟文件: ${fileName}`);
        } else if (virtualFile) {
            virtualFile.content = content;
            virtualFile.mtime = now;
            virtualFile.size = content.length;
            virtualFile.isDirty = true;
            logger.debug(`更新虚拟文件: ${virtualFile.fileName}`);
        }
        
        try {
            const decoder = new TextDecoder();
            const contentStr = decoder.decode(content);
            const cachePath = this.getCachePath(uri);
            fs.writeFileSync(cachePath, contentStr, 'utf-8');
            logger.debug(`更新缓存文件: ${cachePath}`);
        } catch (error) {
            logger.error('写入缓存文件失败', error);
        }
        
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }
    
    delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
        const uriString = uri.toString();
        if (!this.virtualFiles.has(uriString)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        
        this.virtualFiles.delete(uriString);
        
        try {
            const cachePath = this.getCachePath(uri);
            if (fs.existsSync(cachePath)) {
                fs.unlinkSync(cachePath);
            }
        } catch (error) {
            // 忽略缓存删除错误
        }
        
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }
    
    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }
    
    copy?(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions(source);
    }
    
    public getOpenFiles(): VirtualFile[] {
        return Array.from(this.virtualFiles.values());
    }
    
    public getVirtualFile(uri: vscode.Uri): VirtualFile | undefined {
        return this.virtualFiles.get(uri.toString());
    }
    
    public getWebDAVPath(uri: vscode.Uri): string | undefined {
        const virtualFile = this.virtualFiles.get(uri.toString());
        return virtualFile?.webdavPath;
    }
    
    public async saveAll(): Promise<{ success: number; fail: number }> {
        if (!this.webdavClient) {
            throw new Error('WebDAV客户端未初始化');
        }
        
        const files = Array.from(this.virtualFiles.values());
        if (files.length === 0) {
            return { success: 0, fail: 0 };
        }
        
        let success = 0;
        let fail = 0;
        
        for (const file of files) {
            if (file.isDirty) {
                try {
                    const decoder = new TextDecoder();
                    const content = decoder.decode(file.content);
                    await this.webdavClient.createFile(file.webdavPath, content, true);
                    file.isDirty = false;
                    file.mtime = Date.now();
                    success++;
                } catch (error) {
                    fail++;
                    logger.error(`保存文件失败: ${file.fileName}`, error);
                }
            }
        }
        
        return { success, fail };
    }
    
    public closeAll(): void {
        for (const [uriString, file] of this.virtualFiles) {
            try {
                const uri = vscode.Uri.parse(uriString);
                const cachePath = this.getCachePath(uri);
                const decoder = new TextDecoder();
                const content = decoder.decode(file.content);
                fs.writeFileSync(cachePath, content, 'utf-8');
            } catch (error) {
                // 忽略错误
            }
        }
        
        this.virtualFiles.clear();
        logger.info('所有虚拟文件已关闭');
    }
}