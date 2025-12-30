# WebDAV Markdown Manager

![WebDAV Markdown Manager](images/icon-128.png)

[![Version](https://img.shields.io/badge/version-0.0.2-blue.svg)](https://github.com/OllieHu/webdav-markdown-manager/releases)


一个强大的VSCode扩展，让您可以直接编辑和管理WebDAV服务器上的文件，特别优化了Markdown文件的预览和编辑体验。

## 🚀 功能特性

- **🌐 WebDAV集成**: 直接连接和管理WebDAV服务器上的文件
- **📝 Markdown支持**: 专为Markdown文件优化的编辑和预览功能
- **🔄 自动同步**: 保存时自动同步到WebDAV服务器
- **📁 文件管理**: 完整的文件/文件夹创建、删除、上传、下载功能
- **🎯 直观界面**: 在VSCode侧边栏中直接浏览WebDAV文件系统
- **⚡ 实时编辑**: 无需下载即可直接编辑远程文件
- **🔧 灵活配置**: 支持多种WebDAV服务器和认证方式

## 📦 安装


1. 从 [Releases](https://github.com/OllieHu/webdav-markdown-manager/releases) 下载最新的 `.vsix` 文件
2. 在VSCode中按 `Ctrl+Shift+P`，输入 "Extensions: Install from VSIX"
3. 选择下载的文件进行安装

## ⚙️ 配置

在VSCode设置中搜索 "WebDAV" 或通过命令面板打开WebDAV设置：

| 配置项 | 描述 | 默认值 |
|--------|------|--------|
| `webdav.serverUrl` | WebDAV服务器地址 | `""` |
| `webdav.username` | 用户名 | `""` |
| `webdav.password` | 密码 | `""` |
| `webdav.basePath` | 基础路径 | `"/"` |
| `webdav.useHttps` | 使用HTTPS | `true` |
| `webdav.repositoryName` | 仓库名称 | `"WebDAV Repository"` |
| `webdav.localSyncPath` | 本地同步路径 | `"${workspaceFolder}/webdav-sync/${webdav.repositoryName}"` |
| `webdav.autoSync` | 启用自动同步 | `true` |
| `webdav.syncOnSave` | 保存时同步 | `true` |

### 支持的WebDAV服务

- ✅ 坚果云 (https://www.jianguoyun.com/)
- ✅ Nextcloud
- ✅ ownCloud
- ✅ 其他标准WebDAV服务器

## 🎯 使用方法

### 连接服务器
1. 点击侧边栏的WebDAV图标
2. 点击"连接服务器"按钮
3. 填写服务器信息和认证凭据
4. 点击连接

### 文件操作
- **打开文件**: 双击文件直接在编辑器中打开
- **创建文件/文件夹**: 右键点击目录选择相应操作
- **上传文件**: 将本地文件拖拽到目录或使用右键菜单
- **下载文件**: 右键点击文件选择"下载"
- **删除文件**: 右键选择"删除"

### Markdown编辑
- 打开 `.md` 文件后，可以使用VSCode内置的Markdown预览
- 保存时会自动同步到WebDAV服务器
- 支持所有VSCode的Markdown编辑功能

## 📋 命令列表

| 命令 | 功能 |
|------|------|
| `webdav.connect` | 连接WebDAV服务器 |
| `webdav.disconnect` | 断开连接 |
| `webdav.openSettings` | 打开设置界面 |
| `webdav.refresh` | 刷新文件列表 |
| `webdav.createFile` | 创建新文件 |
| `webdav.createFolder` | 创建新文件夹 |
| `webdav.delete` | 删除文件/文件夹 |
| `webdav.upload` | 上传文件 |
| `webdav.download` | 下载文件 |
| `webdav.openPreview` | 预览Markdown文件 |
| `webdav.saveFile` | 保存文件 |
| `webdav.saveAll` | 保存所有文件 |
| `webdav.debugConnection` | 调试连接 |

## 🔧 故障排除

### 连接问题
- 检查服务器地址是否正确（包含协议头：http://或https://）
- 确认用户名和密码正确
- 检查网络连接和防火墙设置

### 认证失败
- 某些WebDAV服务需要应用专用密码
- 检查是否启用了两步验证

### 文件同步问题
- 检查本地同步路径权限
- 确认WebDAV服务器有足够存储空间
- 查看VSCode输出面板的错误信息




