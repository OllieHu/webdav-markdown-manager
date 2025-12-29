// types/logger.d.ts - 类型声明文件
declare module './logger' {
    export enum LogLevel {
        ERROR = 0,
        WARN = 1,
        INFO = 2,
        DEBUG = 3
    }
    
    export interface LogEntry {
        timestamp: Date;
        level: LogLevel;
        message: string;
        details?: any;
        operation?: string;
    }
    
    export class Logger {
        private static instance: Logger;
        static getInstance(): Logger;
        setLogLevel(level: LogLevel): void;
        error(message: string, details?: any, operation?: string): void;
        warn(message: string, details?: any, operation?: string): void;
        info(message: string, details?: any, operation?: string): void;
        debug(message: string, details?: any, operation?: string): void;
        getRecentLogs(count?: number): LogEntry[];
        clear(): void;
        addOutputChannel(channel: any): void;
        setOutputChannel(channel: any): void;
        exportLogs(): string;
    }
    
    export const logger: Logger;
    export function createLogger(): Logger;
    export function addOutputChannel(channel: any): void;
    export function setOutputChannel(channel: any): void;
}