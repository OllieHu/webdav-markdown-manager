(function () {
    const vscode = acquireVsCodeApi();
    let isDebugVisible = false;

    function showMessage(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;

        setTimeout(() => {
            statusEl.className = 'status-message';
        }, 5000);
    }

    function showDebugInfo(info) {
        const debugEl = document.getElementById('debugInfo');
        debugEl.textContent = typeof info === 'string' ? info : JSON.stringify(info, null, 2);

        if (isDebugVisible) {
            debugEl.style.display = 'block';
        } else {
            debugEl.style.display = 'none';
        }
    }

    function toggleDebug() {
        isDebugVisible = !isDebugVisible;
        const debugEl = document.getElementById('debugInfo');
        const toggleBtn = document.getElementById('toggleDebug');

        if (isDebugVisible) {
            debugEl.style.display = 'block';
            toggleBtn.textContent = '隐藏调试信息';
        } else {
            debugEl.style.display = 'none';
            toggleBtn.textContent = '显示调试信息';
        }
    }

    function loadConfigToForm(config) {
        vscode.postMessage({ type: 'log', message: '正在加载配置到表单' });

        document.getElementById('serverUrl').value = config.serverUrl || '';
        document.getElementById('username').value = config.username || '';
        document.getElementById('password').value = config.password || '';
        document.getElementById('basePath').value = config.basePath || '/';
        document.getElementById('useHttps').checked = config.useHttps !== false;
        document.getElementById('repositoryName').value = config.repositoryName || 'WebDAV Repository';
        document.getElementById('localSyncPath').value = config.localSyncPath || '';
        document.getElementById('autoSync').checked = config.autoSync !== false;
        document.getElementById('syncOnSave').checked = config.syncOnSave !== false;

        showDebugInfo({
            action: '配置已加载到表单',
            config: config,
            timestamp: new Date().toISOString()
        });

        showMessage('配置已加载', 'success');
    }

    function getFormConfig() {
        return {
            serverUrl: document.getElementById('serverUrl').value.trim(),
            username: document.getElementById('username').value.trim(),
            password: document.getElementById('password').value.trim(),
            basePath: document.getElementById('basePath').value.trim() || '/',
            useHttps: document.getElementById('useHttps').checked,
            repositoryName: document.getElementById('repositoryName').value.trim() || 'WebDAV Repository',
            localSyncPath: document.getElementById('localSyncPath').value.trim(),
            autoSync: document.getElementById('autoSync').checked,
            syncOnSave: document.getElementById('syncOnSave').checked
        };
    }

    function validateForm() {
        const config = getFormConfig();
        const errors = [];

        if (!config.serverUrl) {
            errors.push('服务器地址不能为空');
        } else if (!config.serverUrl.startsWith('http://') && !config.serverUrl.startsWith('https://')) {
            errors.push('服务器地址必须以 http:// 或 https:// 开头');
        }

        if (!config.username) {
            errors.push('用户名不能为空');
        }

        if (!config.password) {
            errors.push('密码不能为空');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // 事件监听
    document.addEventListener('DOMContentLoaded', () => {
        vscode.postMessage({ type: 'log', message: 'Webview DOM 已加载' });

        // 绑定按钮事件
        document.getElementById('saveConfig').addEventListener('click', () => {
            vscode.postMessage({ type: 'log', message: '点击保存按钮' });

            const validation = validateForm();
            if (!validation.isValid) {
                showMessage(validation.errors.join('; '), 'error');
                return;
            }

            const config = getFormConfig();
            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        });

        document.getElementById('testConnection').addEventListener('click', () => {
            vscode.postMessage({ type: 'log', message: '点击测试连接按钮' });

            const validation = validateForm();
            if (!validation.isValid) {
                showMessage(validation.errors.join('; '), 'error');
                return;
            }

            const config = getFormConfig();
            vscode.postMessage({
                type: 'testConnection',
                config: config
            });
        });

        document.getElementById('loadConfig').addEventListener('click', () => {
            vscode.postMessage({ type: 'log', message: '点击重新加载按钮' });
            vscode.postMessage({ type: 'loadConfig' });
        });

        document.getElementById('browsePath').addEventListener('click', () => {
            vscode.postMessage({ type: 'openFolder' });
            showMessage('请选择本地文件夹路径', 'info');
        });

        document.getElementById('toggleDebug').addEventListener('click', toggleDebug);

        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            vscode.postMessage({
                type: 'log',
                message: `收到消息: ${message.type}`
            });

            switch (message.type) {
                case 'configLoaded':
                    loadConfigToForm(message.config);
                    break;

                case 'saveSuccess':
                    showMessage(message.message || '配置保存成功', 'success');
                    break;

                case 'testConnectionProgress':
                    showMessage(message.message, 'info');
                    break;

                case 'testConnectionSuccess':
                    showMessage(message.message, 'success');
                    break;

                case 'testConnectionError':
                    showMessage(message.message, 'error');
                    break;

                case 'error':
                    showMessage(message.message, 'error');
                    showDebugInfo({
                        error: message.message,
                        timestamp: new Date().toISOString()
                    });
                    break;
            }
        });

        // 请求加载配置
        vscode.postMessage({ type: 'loadConfig' });
    });

    // 添加表单验证实时反馈
    document.querySelectorAll('input[required]').forEach(input => {
        input.addEventListener('blur', () => {
            if (!input.value.trim()) {
                input.style.borderColor = 'var(--vscode-errorForeground)';
            } else {
                input.style.borderColor = '';
            }
        });
    });
})();