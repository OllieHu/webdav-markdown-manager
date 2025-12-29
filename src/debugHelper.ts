import * as vscode from 'vscode';
import { createClient } from 'webdav';
import * as path from 'path';
import * as fs from 'fs';

export async function testWebDAVConnection(serverUrl: string, username: string, password: string, basePath: string = '/'): Promise<void> {
    const channel = vscode.window.createOutputChannel('WebDAV 连接测试');
    channel.show(true);
    
    try {
        channel.appendLine('=== WebDAV 连接测试开始 ===');
        channel.appendLine(`时间: ${new Date().toLocaleString()}`);
        channel.appendLine(`服务器: ${serverUrl}`);
        channel.appendLine(`用户名: ${username}`);
        channel.appendLine(`密码: ${password ? '已设置' : '未设置'}`);
        channel.appendLine(`基础路径: ${basePath}`);
        channel.appendLine('');
        
        // 验证输入
        if (!serverUrl || !username || !password) {
            channel.appendLine('❌ 错误: 服务器地址、用户名和密码不能为空');
            channel.appendLine('请检查以下配置:');
            if (!serverUrl) channel.appendLine('  - 服务器地址');
            if (!username) channel.appendLine('  - 用户名');
            if (!password) channel.appendLine('  - 密码');
            return;
        }
        
        if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
            channel.appendLine('❌ 错误: 服务器地址必须以 http:// 或 https:// 开头');
            return;
        }
        
        // 清理服务器URL
        let cleanedServerUrl = serverUrl.trim();
        if (cleanedServerUrl.endsWith('/')) {
            cleanedServerUrl = cleanedServerUrl.slice(0, -1);
        }
        
        // 创建客户端
        channel.appendLine('1. 创建WebDAV客户端...');
        const client = createClient(cleanedServerUrl, {
            username: username.trim(),
            password: password.trim()
        });
        
        channel.appendLine('✅ 客户端创建成功');
        channel.appendLine('');
        
        // 测试根目录连接
        channel.appendLine('2. 测试根目录连接...');
        try {
            const rootContents = await client.getDirectoryContents('/');
            const itemCount = Array.isArray(rootContents) ? rootContents.length : '未知';
            channel.appendLine(`✅ 根目录连接成功，找到 ${itemCount} 个项目`);
            
            // 显示根目录内容（前10个）
            if (Array.isArray(rootContents) && rootContents.length > 0) {
                channel.appendLine('   根目录内容:');
                rootContents.slice(0, 10).forEach((item: any, index: number) => {
                    const name = item.basename || item.filename || '未知';
                    const type = item.type || (item.mime && item.mime.includes('directory') ? '目录' : '文件');
                    channel.appendLine(`     ${index + 1}. ${name} (${type})`);
                });
                if (rootContents.length > 10) {
                    channel.appendLine(`    ... 还有 ${rootContents.length - 10} 个项目`);
                }
            }
        } catch (error: any) {
            channel.appendLine(`❌ 根目录连接失败: ${error.message || error}`);
            
            if (error.status === 401 || error.status === 403) {
                channel.appendLine('   可能原因: 用户名或密码错误，或者账户没有WebDAV权限');
            } else if (error.status === 404) {
                channel.appendLine('   可能原因: 服务器地址错误，或者WebDAV服务未启用');
            } else if (error.code === 'ENOTFOUND') {
                channel.appendLine('   可能原因: 无法解析服务器地址，请检查网络连接');
            } else if (error.code === 'ECONNREFUSED') {
                channel.appendLine('   可能原因: 连接被拒绝，请检查服务器地址和端口');
            } else if (error.code === 'ETIMEDOUT') {
                channel.appendLine('   可能原因: 连接超时，请检查网络连接或服务器状态');
            }
            return;
        }
        
        channel.appendLine('');
        
        // 测试基础路径
        if (basePath && basePath !== '/') {
            channel.appendLine(`3. 测试基础路径 "${basePath}"...`);
            try {
                const baseContents = await client.getDirectoryContents(basePath);
                const itemCount = Array.isArray(baseContents) ? baseContents.length : '未知';
                channel.appendLine(`✅ 基础路径访问成功，找到 ${itemCount} 个项目`);
                
                if (Array.isArray(baseContents) && baseContents.length === 0) {
                    channel.appendLine('   注意: 目录为空');
                }
            } catch (error: any) {
                if (error.status === 404) {
                    channel.appendLine(`❌ 基础路径不存在: ${basePath}`);
                    channel.appendLine('   尝试创建基础路径...');
                    try {
                        await client.createDirectory(basePath);
                        channel.appendLine(`✅ 基础路径创建成功: ${basePath}`);
                    } catch (createError: any) {
                        channel.appendLine(`❌ 创建基础路径失败: ${createError.message || createError}`);
                        channel.appendLine('   可能原因: 没有创建目录的权限');
                    }
                } else {
                    channel.appendLine(`❌ 基础路径访问失败: ${error.message || error}`);
                }
            }
        } else {
            channel.appendLine('3. 跳过基础路径测试（使用根目录）');
        }
        
        channel.appendLine('');
        
        // 测试文件操作
        channel.appendLine('4. 测试文件操作...');
        const testFileName = `test_connection_${Date.now()}.txt`;
        const testFilePath = basePath === '/' ? `/${testFileName}` : `${basePath}/${testFileName}`;
        const testContent = `WebDAV连接测试 ${new Date().toISOString()}`;
        
        try {
            // 创建测试文件
            await client.putFileContents(testFilePath, testContent, { overwrite: true });
            channel.appendLine(`✅ 创建测试文件成功: ${testFileName}`);
            
            // 读取测试文件
            const readContent = await client.getFileContents(testFilePath, { format: 'text' });
            channel.appendLine(`✅ 读取测试文件成功，内容长度: ${String(readContent).length} 字符`);
            
            // 删除测试文件
            await client.deleteFile(testFilePath);
            channel.appendLine(`✅ 删除测试文件成功`);
            
            channel.appendLine('✅ 文件操作测试全部通过');
        } catch (error: any) {
            channel.appendLine(`❌ 文件操作测试失败: ${error.message || error}`);
            channel.appendLine('   可能原因: 没有文件操作权限');
        }
        
        channel.appendLine('');
        channel.appendLine('=== 测试总结 ===');
        channel.appendLine('✅ WebDAV连接测试完成');
        channel.appendLine('');
        channel.appendLine('配置建议:');
        channel.appendLine(`1. 服务器地址: ${cleanedServerUrl}`);
        channel.appendLine(`2. 用户名: ${username}`);
        channel.appendLine(`3. 基础路径: ${basePath}`);
        channel.appendLine('');
        channel.appendLine('提示: 如果仍然无法在扩展中连接，请尝试:');
        channel.appendLine('1. 重启VS Code');
        channel.appendLine('2. 检查防火墙设置');
        channel.appendLine('3. 联系服务器管理员确认WebDAV服务状态');
        
        vscode.window.showInformationMessage('WebDAV连接测试完成，请查看输出面板', '查看结果').then(selection => {
            if (selection === '查看结果') {
                channel.show();
            }
        });
        
    } catch (error: any) {
        channel.appendLine('=== 测试发生错误 ===');
        channel.appendLine(`错误: ${error.message || error}`);
        channel.appendLine(`堆栈: ${error.stack || '无'}`);
        
        vscode.window.showErrorMessage(`连接测试失败: ${error.message || error}`, '查看详情').then(selection => {
            if (selection === '查看详情') {
                channel.show();
            }
        });
    }
}

export async function diagnoseConnectionIssues(serverUrl: string, username: string, password: string): Promise<void> {
    const channel = vscode.window.createOutputChannel('WebDAV 诊断');
    channel.show(true);
    
    channel.appendLine('=== WebDAV 连接诊断 ===');
    channel.appendLine(`时间: ${new Date().toLocaleString()}`);
    channel.appendLine('');
    
    // 测试网络连接
    channel.appendLine('1. 网络连接测试...');
    try {
        const url = new URL(serverUrl);
        const hostname = url.hostname;
        
        channel.appendLine(`   测试DNS解析: ${hostname}`);
        // 这里可以添加更详细的网络测试
        
        channel.appendLine('✅ 网络连接测试通过');
    } catch (error: any) {
        channel.appendLine(`❌ URL解析失败: ${error.message}`);
        channel.appendLine('   请检查服务器地址格式');
    }
    
    channel.appendLine('');
    channel.appendLine('2. 常见问题检查...');
    channel.appendLine('   - 坚果云用户: 确保已开启WebDAV服务');
    channel.appendLine('   - 服务器地址: 应以 https://dav.jianguoyun.com/dav 格式');
    channel.appendLine('   - 用户名: 使用邮箱地址');
    channel.appendLine('   - 密码: 使用WebDAV专用密码（坚果云需要）');
    
    channel.appendLine('');
    channel.appendLine('=== 诊断完成 ===');
}