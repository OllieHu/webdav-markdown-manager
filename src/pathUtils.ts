// pathUtils.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { logger } from './logger';

export class PathUtils {
    /**
     * 标准化WebDAV路径
     */
    public static normalizeWebDAVPath(inputPath: string, basePath: string = '/'): string {
        if (!inputPath) {
            return basePath === '/' ? '/' : basePath;
        }

        // 标准化路径
        let normalized = inputPath
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\//, '')
            .replace(/\/$/, '');

        // 如果路径为空，返回basePath
        if (normalized === '') {
            return basePath === '/' ? '/' : basePath.replace(/\/$/, '');
        }

        return '/' + normalized;
    }

    /**
     * 从完整WebDAV路径中获取相对于basePath的相对路径
     */
    public static getRelativePathFromBase(fullPath: string, basePath: string): string {
        let normalizedFullPath = fullPath
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\//, '')
            .replace(/\/$/, '');

        let normalizedBasePath = basePath
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\//, '')
            .replace(/\/$/, '');

        // 如果basePath为空或根目录
        if (normalizedBasePath === '' || normalizedBasePath === '/') {
            return normalizedFullPath;
        }

        // 检查fullPath是否以basePath开头
        if (normalizedFullPath.startsWith(normalizedBasePath + '/')) {
            return normalizedFullPath.substring(normalizedBasePath.length + 1);
        } else if (normalizedFullPath === normalizedBasePath) {
            return '';
        } else {
            logger.warn(`路径 "${fullPath}" 不以basePath "${basePath}" 开头`);
            return normalizedFullPath;
        }
    }

    /**
     * 安全地构建本地路径，避免父子目录同名冲突
     */
    public static safeLocalPath(localBase: string, relativePath: string): string {
        // 分离文件名和目录
        const dirname = path.dirname(relativePath);
        const basename = path.basename(relativePath);
        
        // 构建本地目录路径
        let localDir = localBase;
        if (dirname && dirname !== '.') {
            localDir = path.join(localBase, dirname);
        }

        // 检查是否有同名目录存在（避免文件与目录同名冲突）
        const potentialDir = path.join(localDir, basename);
        if (fs.existsSync(potentialDir) && fs.statSync(potentialDir).isDirectory()) {
            // 存在同名目录，添加文件后缀
            const newBasename = basename + '.file';
            logger.warn(`检测到同名目录，将文件重命名为: ${newBasename}`);
            return path.join(localDir, newBasename);
        }

        return path.join(localDir, basename);
    }

    /**
     * 获取操作系统特定的文档目录
     */
    public static getDocumentsDirectory(): string {
        const platform = os.platform();
        const homeDir = os.homedir();

        switch (platform) {
            case 'win32':
                // Windows: 尝试多个可能的路径
                const winPaths = [
                    path.join(homeDir, 'Documents'),
                    path.join(homeDir, 'My Documents'),
                    path.join(process.env.USERPROFILE || homeDir, 'Documents'),
                    path.join(process.env.USERPROFILE || homeDir, 'My Documents')
                ];
                
                for (const p of winPaths) {
                    if (fs.existsSync(p)) {
                        return p;
                    }
                }
                return path.join(homeDir, 'Documents');
                
            case 'darwin':
                return path.join(homeDir, 'Documents');
                
            case 'linux':
                // Linux: 尝试多个可能的路径
                const linuxPaths = [
                    path.join(homeDir, 'Documents'),
                    path.join(homeDir, '文档'),
                    path.join(homeDir, 'My Documents'),
                    path.join(homeDir, '我的文档')
                ];
                
                for (const p of linuxPaths) {
                    if (fs.existsSync(p)) {
                        return p;
                    }
                }
                return path.join(homeDir, 'Documents');
                
            default:
                return path.join(homeDir, 'Documents');
        }
    }

    /**
     * 确保路径的父目录存在
     */
    public static ensureParentDirectory(filePath: string): void {
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
    }

    /**
     * 创建安全的目录结构，避免冲突
     */
    public static createSafeDirectory(localPath: string): string {
        let currentPath = localPath;
        let attempt = 1;
        
        while (fs.existsSync(currentPath)) {
            const stats = fs.statSync(currentPath);
            if (stats.isDirectory()) {
                return currentPath;
            } else {
                const dirname = path.dirname(currentPath);
                const basename = path.basename(localPath);
                currentPath = path.join(dirname, `${basename}_${attempt}`);
                attempt++;
            }
        }
        
        fs.mkdirSync(currentPath, { recursive: true });
        return currentPath;
    }

    /**
     * 比较两个路径是否相同
     */
    public static arePathsEqual(path1: string, path2: string): boolean {
        const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
        return normalize(path1) === normalize(path2);
    }
}