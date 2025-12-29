// errorHandlingDecorator.ts
import * as vscode from 'vscode';

// 创建临时 logger 如果不存在
const tempLogger = {
    error: (message: string, details?: any, operation?: string) => {
        console.error(`[ERROR] ${operation || ''} ${message}`, details);
    },
    warn: (message: string, details?: any, operation?: string) => {
        console.warn(`[WARN] ${operation || ''} ${message}`, details);
    },
    info: (message: string, details?: any, operation?: string) => {
        console.log(`[INFO] ${operation || ''} ${message}`, details);
    },
    debug: (message: string, details?: any, operation?: string) => {
        console.log(`[DEBUG] ${operation || ''} ${message}`, details);
    }
};

// 尝试导入 logger，如果失败使用临时版本
let logger: any;
try {
    logger = require('./logger').logger;
} catch {
    logger = tempLogger;
}

export interface ErrorHandlingOptions {
    operation?: string;
    showNotification?: boolean;
    retryAction?: () => Promise<void>;
    showSettingsAction?: boolean;
    context?: any;
}

/**
 * 简化的错误处理装饰器
 */
export function handleErrors(options?: ErrorHandlingOptions) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            try {
                return await originalMethod.apply(this, args);
            } catch (error) {
                const operation = options?.operation || propertyKey;
                const errorMessage = error instanceof Error ? error.message : String(error);
                
                // 记录错误日志
                logger.error(`${operation} failed: ${errorMessage}`, error, operation);
                
                // 根据配置决定是否显示通知
                if (options?.showNotification !== false) {
                    await showUserFriendlyError(error, operation, options);
                }
                throw error;
            }
        };
        
        return descriptor;
    };
}

/**
 * 统一的错误处理函数
 */
export async function handleError(
    error: any, 
    operation: string, 
    options?: ErrorHandlingOptions
): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 记录错误日志
    logger.error(`${operation} failed: ${errorMessage}`, error, operation);
    
    // 根据配置决定是否显示通知
    if (options?.showNotification !== false) {
        await showUserFriendlyError(error, operation, options);
    }
}

/**
 * 显示用户友好的错误提示
 */
export async function showUserFriendlyError(
    error: any, 
    operation: string, 
    options?: ErrorHandlingOptions
): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const userMessage = getUserFriendlyErrorMessage(errorMessage, operation);
    
    const actions: string[] = [];
    if (options?.retryAction) {
        actions.push('重试');
    }
    if (options?.showSettingsAction) {
        actions.push('设置');
    }
    if (actions.length === 0) {
        actions.push('确定');
    }
    
    const selection = await vscode.window.showErrorMessage(userMessage, ...actions);
    
    if (selection === '重试' && options?.retryAction) {
        try {
            await options.retryAction();
        } catch (retryError) {
            logger.error('Retry failed', retryError, 'retry');
        }
    } else if (selection === '设置') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'webdav');
    }
}

/**
 * 将技术错误消息转换为用户友好的消息
 */
export function getUserFriendlyErrorMessage(technicalMessage: string, operation: string): string {
    // 网络相关错误
    if (technicalMessage.includes('timeout') || technicalMessage.includes('timed out')) {
        return `${operation} 超时。请检查网络连接或增加超时设置。`;
    }
    
    if (technicalMessage.includes('ECONNREFUSED') || technicalMessage.includes('ENOTFOUND')) {
        return `${operation} 失败：无法连接到服务器。请检查服务器地址和网络连接。`;
    }
    
    if (technicalMessage.includes('network')) {
        return `${operation} 失败：网络错误。请检查网络连接状态。`;
    }
    
    // 认证相关错误
    if (technicalMessage.includes('401') || technicalMessage.includes('Unauthorized')) {
        return `${operation} 失败：认证失败。请检查用户名和密码是否正确。`;
    }
    
    // 权限相关错误
    if (technicalMessage.includes('403') || technicalMessage.includes('Forbidden')) {
        return `${operation} 失败：权限不足。请检查您是否有足够的权限访问此资源。`;
    }
    
    // 文件相关错误
    if (technicalMessage.includes('404') || technicalMessage.includes('Not Found')) {
        return `${operation} 失败：文件或目录不存在。请检查路径是否正确。`;
    }
    
    if (technicalMessage.includes('409') || technicalMessage.includes('Conflict')) {
        return `${operation} 失败：文件冲突。请检查是否有其他用户正在编辑同一文件。`;
    }
    
    // 服务器相关错误
    if (technicalMessage.includes('500') || technicalMessage.includes('Internal Server Error')) {
        return `${operation} 失败：服务器内部错误。请稍后重试。`;
    }
    
    if (technicalMessage.includes('502') || technicalMessage.includes('Bad Gateway')) {
        return `${operation} 失败：服务器网关错误。请稍后重试。`;
    }
    
    if (technicalMessage.includes('503') || technicalMessage.includes('Service Unavailable')) {
        return `${operation} 失败：服务暂时不可用。请稍后重试。`;
    }
    
    // 重试相关错误
    if (technicalMessage.includes('retries') || technicalMessage.includes('attempts')) {
        return `${operation} 失败：重试次数已用完。请检查网络连接后手动重试。`;
    }
    
    // 默认错误消息
    return `${operation} 失败：${technicalMessage}`;
}

/**
 * 性能监控装饰器
 */
export function performanceMonitor(target: any, propertyName: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
        const start = performance.now();
        
        try {
            const result = await originalMethod.apply(this, args);
            const duration = performance.now() - start;
            
            // 如果操作时间超过1秒，记录警告
            if (duration > 1000) {
                logger.warn(`Performance: ${propertyName} took ${duration.toFixed(2)}ms`, undefined, propertyName);
            } else {
                logger.debug(`Performance: ${propertyName} completed in ${duration.toFixed(2)}ms`, undefined, propertyName);
            }
            
            return result;
        } catch (error) {
            const duration = performance.now() - start;
            logger.error(`Performance: ${propertyName} failed after ${duration.toFixed(2)}ms`, error, propertyName);
            throw error;
        }
    };
    
    return descriptor;
}

/**
 * 输入验证装饰器
 */
export function validateInput(validationFn: (args: any[]) => string | null) {
    return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
        const method = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const validationError = validationFn(args);
            if (validationError) {
                const error = new Error(validationError);
                await handleError(error, propertyName, { showNotification: true });
                throw error;
            }
            
            return await method.apply(this, args);
        };
        
        return descriptor;
    };
}

/**
 * 常用的验证函数
 */
export const Validators = {
    /**
     * 验证 URL 格式
     */
    url: (urlIndex: number = 0) => (args: any[]) => {
        const url = args[urlIndex];
        if (typeof url !== 'string' || !url.trim()) {
            return 'URL 不能为空';
        }
        
        try {
            new URL(url);
            return null;
        } catch {
            return 'URL 格式不正确';
        }
    },
    
    /**
     * 验证文件路径
     */
    filePath: (pathIndex: number = 0) => (args: any[]) => {
        const path = args[pathIndex];
        if (typeof path !== 'string' || !path.trim()) {
            return '文件路径不能为空';
        }
        
        if (path.includes('..') || path.includes('~')) {
            return '文件路径包含不安全字符';
        }
        
        return null;
    },
    
    /**
     * 验证必需参数
     */
    required: (paramIndex: number, paramName: string) => (args: any[]) => {
        const param = args[paramIndex];
        if (param === null || param === undefined || param === '') {
            return `${paramName} 不能为空`;
        }
        return null;
    }
};