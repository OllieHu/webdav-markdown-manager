import * as vscode from 'vscode';

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
    private logLevel: LogLevel = LogLevel.WARN;
    private logs: LogEntry[] = [];
    private maxLogEntries: number = 1000;
    private outputChannel: vscode.OutputChannel | null = null;

    private constructor() {
        const isDevelopment = process.env.NODE_ENV === 'development';
        this.logLevel = isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    private sanitize(data: any): any {
        if (typeof data === 'string') {
            return data
                .replace(/password=\w+/gi, 'password=***')
                .replace(/token=\w+/gi, 'token=***')
                .replace(/auth=\w+/gi, 'auth=***');
        }
        
        if (typeof data === 'object' && data !== null) {
            const sanitized = { ...data };
            if (sanitized.password) {sanitized.password = '***';}
            if (sanitized.token) {sanitized.token = '***';}
            if (sanitized.auth) {sanitized.auth = '***';}
            return sanitized;
        }
        
        return data;
    }

    private addLog(level: LogLevel, message: string, details?: any, operation?: string): void {
        if (level > this.logLevel) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            details: details ? this.sanitize(details) : undefined,
            operation
        };

        this.logs.push(entry);

        if (this.logs.length > this.maxLogEntries) {
            this.logs = this.logs.slice(-this.maxLogEntries);
        }

        this.outputToConsole(entry);
    }

    private outputToConsole(entry: LogEntry): void {
        const timestamp = entry.timestamp.toISOString();
        const prefix = `[WebDAV ${this.getLevelName(entry.level)}] ${timestamp}`;
        
        switch (entry.level) {
            case LogLevel.ERROR:
                console.error(prefix, entry.message, entry.details || '');
                break;
            case LogLevel.WARN:
                console.warn(prefix, entry.message, entry.details || '');
                break;
            case LogLevel.INFO:
                console.log(prefix, entry.message, entry.details || '');
                break;
            case LogLevel.DEBUG:
                console.log(prefix, entry.message, entry.details || '');
                break;
        }
    }

    private getLevelName(level: LogLevel): string {
        switch (level) {
            case LogLevel.ERROR: return 'ERROR';
            case LogLevel.WARN: return 'WARN';
            case LogLevel.INFO: return 'INFO';
            case LogLevel.DEBUG: return 'DEBUG';
            default: return 'UNKNOWN';
        }
    }

    error(message: string, details?: any, operation?: string): void {
        this.addLog(LogLevel.ERROR, message, details, operation);
    }

    warn(message: string, details?: any, operation?: string): void {
        this.addLog(LogLevel.WARN, message, details, operation);
    }

    info(message: string, details?: any, operation?: string): void {
        this.addLog(LogLevel.INFO, message, details, operation);
    }

    debug(message: string, details?: any, operation?: string): void {
        this.addLog(LogLevel.DEBUG, message, details, operation);
    }

    getRecentLogs(count: number = 100): LogEntry[] {
        return this.logs.slice(-count);
    }

    clear(): void {
        this.logs = [];
    }

    addOutputChannel(channel: vscode.OutputChannel): void {
        this.outputChannel = channel;
    }

    setOutputChannel(channel: vscode.OutputChannel): void {
        this.outputChannel = channel;
    }

    exportLogs(): string {
        return JSON.stringify(this.logs, null, 2);
    }
}

export const logger = Logger.getInstance();

export function createLogger(): Logger {
    return Logger.getInstance();
}

export function addOutputChannel(channel: vscode.OutputChannel) {
    logger.addOutputChannel(channel);
}

export function setOutputChannel(channel: vscode.OutputChannel) {
    logger.setOutputChannel(channel);
}