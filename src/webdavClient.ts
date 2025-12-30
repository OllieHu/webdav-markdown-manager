import * as vscode from 'vscode';
import { createClient, WebDAVClient } from 'webdav';
import * as fs from 'fs';
import * as path from 'path';

// 使用内联logger
const tempLogger = {
    info: (message: string, ...args: any[]) => console.log(`[INFO][Client] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[ERROR][Client] ${message}`, ...args),
    debug: (message: string, ...args: any[]) => console.log(`[DEBUG][Client] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[WARN][Client] ${message}`, ...args)
};

export interface WebDAVConnection {
    client: WebDAVClient;
    connected: boolean;
    serverUrl: string;
    basePath: string;
    username: string;
    lastConnected: number;
}

export class MyWebDAVClient {
    private connection: WebDAVConnection | null = null;
    private context: vscode.ExtensionContext;
    private connectionPromise: Promise<boolean> | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }
    
    public get client(): WebDAVClient | null {
        return this.connection?.client || null;
    }
    
    public get isConnected(): boolean {
        return this.connection?.connected || false;
    }
    
    public get serverUrl(): string {
        return this.connection?.serverUrl || '';
    }

    async connect(serverUrl: string, username: string, password: string, basePath: string = '/'): Promise<boolean> {
        // 如果正在连接中，等待完成
        if (this.connectionPromise) {
            tempLogger.debug('连接正在进行中，等待完成...');
            return await this.connectionPromise;
        }

        this.connectionPromise = this.connectInternal(serverUrl, username, password, basePath);
        try {
            const result = await this.connectionPromise;
            return result;
        } finally {
            this.connectionPromise = null;
        }
    }

    private async connectInternal(serverUrl: string, username: string, password: string, basePath: string = '/'): Promise<boolean> {
        tempLogger.info(`连接中: ${serverUrl}, 用户: ${username}, 路径: ${basePath}`);
        
        try {
            // 验证输入
            if (!serverUrl || !username || !password) {
                throw new Error('服务器地址、用户名或密码不能为空');
            }
            
            if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
                throw new Error('服务器地址必须以 http:// 或 https:// 开头');
            }
            
            // 清理服务器URL
            let cleanedServerUrl = serverUrl.trim();
            if (cleanedServerUrl.endsWith('/')) {
                cleanedServerUrl = cleanedServerUrl.slice(0, -1);
            }
            
            // 创建带超时的Promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('连接超时，请检查网络连接或服务器状态')), 30000);
            });
            
            tempLogger.debug(`创建WebDAV客户端...`);
            const client = createClient(cleanedServerUrl, {
                username: username.trim(),
                password: password.trim(),
                maxBodyLength: 100 * 1024 * 1024,
                maxContentLength: 100 * 1024 * 1024
            });
            
            // 测试连接（使用Promise.race添加超时）
            tempLogger.debug(`测试WebDAV连接...`);
            try {
                const connectPromise = this.testConnectionInternal(client, basePath);
                await Promise.race([connectPromise, timeoutPromise]);
                
                tempLogger.info('WebDAV连接测试成功');
            } catch (testError: any) {
                // 错误处理保持不变...
                if (testError.message === '连接超时，请检查网络连接或服务器状态') {
                    throw testError;
                }
                
                const status = testError.status;
                if (status === 401 || status === 403) {
                    throw new Error('认证失败，请检查用户名和密码');
                } else if (status === 404) {
                    throw new Error('服务器地址不存在或无法访问');
                } else if (status === 0) {
                    throw new Error('网络连接失败，请检查网络设置');
                } else if (testError.code === 'ENOTFOUND') {
                    throw new Error('无法解析服务器地址，请检查网络连接');
                } else if (testError.code === 'ECONNREFUSED') {
                    throw new Error('连接被拒绝，请检查服务器地址和端口');
                } else if (testError.code === 'ETIMEDOUT') {
                    throw new Error('连接超时，请检查网络连接');
                } else if (testError.code === 'CERT_HAS_EXPIRED') {
                    throw new Error('SSL证书已过期，请联系服务器管理员');
                } else {
                    throw new Error(`连接测试失败: ${testError.message || '未知错误'}`);
                }
            }
            
            // 保存连接信息
            this.connection = {
                client: client,
                connected: true,
                serverUrl: cleanedServerUrl,
                basePath: basePath,
                username: username,
                lastConnected: Date.now()
            };
            
            tempLogger.info(`连接成功: ${cleanedServerUrl}, 基础路径: ${basePath}`);
            return true;
        } catch (error: any) {
            tempLogger.error('连接失败:', error.message || error);
            this.connection = null;
            throw error;
        }
    }

    private async testConnectionInternal(client: any, basePath: string): Promise<void> {
        // 测试根目录访问
        try {
            await client.getDirectoryContents('/');
            tempLogger.debug('根目录访问成功');
            
            // 测试指定路径访问
            if (basePath && basePath !== '/') {
                try {
                    await client.getDirectoryContents(basePath);
                    tempLogger.info(`基础路径 ${basePath} 访问成功`);
                } catch (pathError: any) {
                    // 404错误表示路径不存在，尝试创建
                    if (pathError.status === 404) {
                        tempLogger.info(`基础路径 ${basePath} 不存在，尝试创建`);
                        await client.createDirectory(basePath);
                        tempLogger.info(`基础路径 ${basePath} 创建成功`);
                    } else {
                        throw pathError;
                    }
                }
            }
        } catch (error: any) {
            // 如果是已知的WebDAV服务，可以尝试特殊处理
            if (this.connection?.serverUrl.includes('jianguoyun.com')) {
                tempLogger.debug('检测到坚果云服务器，尝试特殊处理...');
                // 坚果云不需要测试根目录，可以直接测试基础路径
                if (basePath && basePath !== '/') {
                    try {
                        await client.getDirectoryContents(basePath);
                        tempLogger.info(`坚果云基础路径 ${basePath} 访问成功`);
                    } catch (jianguoyunError: any) {
                        if (jianguoyunError.status === 404) {
                            tempLogger.info(`坚果云基础路径 ${basePath} 不存在，尝试创建`);
                            await client.createDirectory(basePath);
                            tempLogger.info(`坚果云基础路径 ${basePath} 创建成功`);
                        } else {
                            throw jianguoyunError;
                        }
                    }
                } else {
                    // 坚果云根目录需要特殊权限，跳过测试
                    tempLogger.warn('坚果云根目录可能需要特殊权限，跳过测试');
                }
            } else {
                throw error;
            }
        }
    }

    async disconnect(): Promise<void> {
        if (this.connection) {
            this.connection.connected = false;
            this.connection = null;
            tempLogger.info('已断开WebDAV连接');
        }
    }

    async getDirectoryContents(path: string = '/'): Promise<any[]> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.info(`获取目录内容: ${path}`);
        
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('获取目录内容超时')), 10000);
            });
            
            const contentsPromise = this.connection.client.getDirectoryContents(path, { deep: false });
            const contents = await Promise.race([contentsPromise, timeoutPromise]);
            
            let items: any[] = [];
            
            // 处理不同的返回格式
            if (Array.isArray(contents)) {
                items = contents;
            } else if (contents && typeof contents === 'object') {
                // webdav库可能返回对象
                if (Array.isArray((contents as any).data)) {
                    items = (contents as any).data;
                } else if (Array.isArray((contents as any).items)) {
                    items = (contents as any).items;
                } else if (Array.isArray((contents as any).files)) {
                    items = (contents as any).files;
                } else {
                    // 尝试将对象转换为数组
                    items = Object.values(contents);
                }
            }
            
            // 过滤隐藏文件
            const filteredContents = items.filter((item: any) => {
                const basename = item.basename || item.filename || '';
                return !basename.startsWith('.');
            });
            
            tempLogger.debug(`获取到 ${filteredContents.length} 个文件/目录`);
            
            // 格式化返回数据
            return filteredContents.map((item: any) => {
                const basename = item.basename || item.filename || '';
                const type = item.type || (item.mime && item.mime.includes('directory') ? 'directory' : 'file');
                
                return {
                    basename,
                    type,
                    size: item.size || 0,
                    lastmod: item.lastmod || new Date().toISOString(),
                    filename: item.filename || basename,
                    mime: item.mime
                };
            });
        } catch (error: any) {
            tempLogger.error(`获取目录内容失败: ${path}`, error);
            
            // 提供更详细的错误信息
            if (error.message.includes('404') || error.status === 404) {
                throw new Error(`路径不存在: ${path}`);
            } else if (error.message.includes('401') || error.status === 401) {
                throw new Error('认证失败，请重新连接');
            } else if (error.message.includes('timeout') || error.message.includes('超时')) {
                throw new Error('请求超时，请检查网络连接');
            } else if (error.code === 'ENOTFOUND') {
                throw new Error('网络连接失败，请检查网络设置');
            }
            
            throw error;
        }
    }

    async createFile(path: string, content: string = '', overwrite: boolean = true): Promise<void> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.info(`创建文件: ${path}, 覆盖: ${overwrite}`);
        
        try {
            // 确保父目录存在
            const parentPath = this.getParentPath(path);
            if (parentPath && parentPath !== '/') {
                try {
                    await this.connection.client.stat(parentPath);
                } catch (error: any) {
                    if (error.status === 404) {
                        await this.createDirectory(parentPath);
                    }
                }
            }
            
            await this.connection.client.putFileContents(path, content, { overwrite });
            tempLogger.info(`文件创建成功: ${path}`);
        } catch (error) {
            tempLogger.error(`创建文件失败: ${path}`, error);
            throw error;
        }
    }

    async createDirectory(path: string): Promise<void> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.info(`创建目录: ${path}`);
        
        try {
            await this.connection.client.createDirectory(path, { recursive: true });
            tempLogger.info(`目录创建成功: ${path}`);
        } catch (error) {
            tempLogger.error(`创建目录失败: ${path}`, error);
            throw error;
        }
    }

    async getFileContents(path: string, options: { format?: 'binary' | 'text' } = {}): Promise<Buffer | string> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.info(`获取文件内容: ${path}, 格式: ${options.format || 'text'}`);
        
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('获取文件内容超时')), 15000);
            });
            
            if (options.format === 'binary') {
                const contentPromise = this.connection.client.getFileContents(path, { format: 'binary' }) as Promise<Buffer>;
                return await Promise.race([contentPromise, timeoutPromise]) as Buffer;
            } else {
                const contentPromise = this.connection.client.getFileContents(path, { format: 'text' }) as Promise<string>;
                return await Promise.race([contentPromise, timeoutPromise]) as string;
            }
        } catch (error: any) {
            tempLogger.error(`获取文件内容失败: ${path}`, error);
            
            if (error.status === 404) {
                throw new Error(`文件不存在: ${path}`);
            } else if (error.status === 403) {
                throw new Error('没有权限访问此文件');
            }
            
            throw error;
        }
    }

    async deleteFile(path: string): Promise<void> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.info(`删除文件: ${path}`);
        
        try {
            await this.connection.client.deleteFile(path);
            tempLogger.info(`文件删除成功: ${path}`);
        } catch (error) {
            tempLogger.error(`删除文件失败: ${path}`, error);
            throw error;
        }
    }

    async deleteDirectory(path: string): Promise<void> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.info(`删除目录: ${path}`);
        
        try {
            // 递归删除目录内容
            const contents = await this.getDirectoryContents(path);
            for (const item of contents) {
                const itemPath = path === '/' ? `/${item.basename}` : `${path}/${item.basename}`;
                if (item.type === 'directory') {
                    await this.deleteDirectory(itemPath);
                } else {
                    await this.deleteFile(itemPath);
                }
            }
            
            // 删除空目录
            await this.connection.client.deleteFile(path);
            tempLogger.info(`目录删除成功: ${path}`);
        } catch (error) {
            tempLogger.error(`删除目录失败: ${path}`, error);
            throw error;
        }
    }

    async stat(path: string): Promise<any> {
        if (!this.connection || !this.connection.client) {
            throw new Error('未连接到WebDAV服务器');
        }
        
        tempLogger.debug(`获取文件状态: ${path}`);
        
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('获取文件状态超时')), 10000);
            });
            
            const statPromise = this.connection.client.stat(path);
            return await Promise.race([statPromise, timeoutPromise]);
        } catch (error) {
            tempLogger.error(`获取文件状态失败: ${path}`, error);
            throw error;
        }
    }

    private getParentPath(filePath: string): string {
        const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        
        if (lastSlash <= 0) {
            return '/';
        }
        
        return normalized.substring(0, lastSlash);
    }

    getCurrentConnection(): WebDAVConnection | undefined {
        return this.connection || undefined;
    }

    public async checkConnection(): Promise<{ success: boolean; message: string; details?: any }> {
        if (!this.connection || !this.connection.client) {
            return { success: false, message: '未连接' };
        }
        
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('连接测试超时')), 10000);
            });
            
            const statPromise = this.connection.client.stat('/');
            const stat = await Promise.race([statPromise, timeoutPromise]);
            
            return { 
                success: true, 
                message: '连接正常',
                details: {
                    serverUrl: this.connection.serverUrl,
                    basePath: this.connection.basePath,
                    username: this.connection.username,
                    rootInfo: stat
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: error.message || '连接测试失败',
                details: error
            };
        }
    }
}