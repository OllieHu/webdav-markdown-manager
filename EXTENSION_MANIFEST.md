# WebDAV Markdown Manager - 扩展清单文件说明


## 扩展基本信息

### 基本信息
```json
{
  "name": "webdav-markdown",                // 扩展的唯一标识符
  "displayName": "WebDAV Markdown Manager", // 在扩展面板中显示的名称
  "description": "直接编辑和管理WebDAV服务器上的文件，支持Markdown预览", // 扩展描述
  "version": "0.0.2",                      // 当前版本
  "publisher": "webdav-extension",          // 发布者ID
  "icon": "images/icon-128.png",           // 扩展图标(128x128像素)
  "preview": true                           // 标记为预览版本
}
```

### 扩展图标配置

扩展图标使用 128x128 像素的 PNG 图像，图标设计包含以下元素：
- **云形图案**：代表 WebDAV 云存储功能
- **文件夹图标**：表示文件管理功能
- **MD 文档**：代表 Markdown 支持
- **同步箭头**：表示同步功能



## 扩展分类

### 分类标签
```json
{
  "categories": [
    "Other",              // 其他类别
    "Programming Languages", // 编程语言
    "SCM Providers"       // 源代码管理提供程序
  ]
}
```

### 关键词
```json
{
  "keywords": [
    "webdav",      // WebDAV协议
    "markdown",    // Markdown支持
    "cloud",       // 云存储
    "file manager", // 文件管理
    "sync"         // 同步功能
  ]
}
```

## 扩展激活

### 激活事件
```json
{
  "activationEvents": [
    "onStartupFinished"  // VSCode启动完成后激活
  ]
}
```

## 贡献点配置

### 活动栏视图容器
```json
{
  "viewsContainers": {
    "activitybar": [
      {
        "id": "webdav-sidebar",     // 视图容器ID
        "title": "WebDAV",          // 显示标题
        "icon": "$(cloud)"          // 活动栏图标
      }
    ]
  }
}
```

### 侧边栏视图
```json
{
  "views": {
    "webdav-sidebar": [
      {
        "id": "webdavExplorer",     // 视图ID
        "name": "WebDAV文件",      // 视图名称
        "when": "true"             // 始终显示
      }
    ]
  }
}
```

### 欢迎视图
```json
{
  "viewsWelcome": [
    {
      "view": "webdavExplorer",    // 关联视图
      "contents": "还没有连接到WebDAV服务器。\n[点击连接](command:webdav.connect)" // 欢迎文本
    }
  ]
}
```

## 配置选项

### WebDAV 连接配置
```json
{
  "configuration": {
    "title": "WebDAV",
    "properties": {
      "webdav.serverUrl": {
        "type": "string",
        "default": "",
        "description": "WebDAV服务器地址，例如: https://dav.jianguoyun.com/dav"
      },
      "webdav.username": {
        "type": "string",
        "default": "",
        "description": "WebDAV用户名"
      },
      "webdav.password": {
        "type": "string",
        "default": "",
        "description": "WebDAV密码",
        "scope": "machine"  // 机器级别存储，不共享
      },
      // ... 其他配置项
    }
  }
}
```

## 命令定义

### 主要命令
扩展定义了以下主要命令类别：

#### 连接管理
- `webdav.connect` - 连接服务器
- `webdav.disconnect` - 断开连接
- `webdav.reconnect` - 重新连接

#### 文件操作
- `webdav.openFile` - 打开文件
- `webdav.createFile` - 新建文件
- `webdav.createFolder` - 新建文件夹
- `webdav.delete` - 删除

#### 同步操作
- `webdav.upload` - 上传
- `webdav.download` - 下载
- `webdav.saveFile` - 保存文件
- `webdav.saveAll` - 保存所有

#### 界面操作
- `webdav.openSettings` - 打开设置
- `webdav.refresh` - 刷新
- `webdav.openLocalFolder` - 打开本地文件夹

#### Markdown 相关
- `webdav.openPreview` - 预览Markdown

#### 调试功能
- `webdav.debugConnection` - 调试连接
- `webdav.checkConnection` - 检查连接状态
- `webdav.showConfigStatus` - 显示配置状态

## 菜单配置

### 视图标题菜单
```json
{
  "menus": {
    "view/title": [
      {
        "command": "webdav.connect",
        "when": "view == webdavExplorer",
        "group": "navigation@1"  // 导航组，位置1
      },
      // ... 其他菜单项
    ]
  }
}
```

### 上下文菜单
```json
{
  "view/item/context": [
    {
      "command": "webdav.openFile",
      "when": "view == webdavExplorer && viewItem == webdav-file",  // 文件项显示
      "group": "inline"  // 内联显示
    },
    // ... 其他上下文菜单项
  ]
}
```

### 命令面板
```json
{
  "commandPalette": [
    {
      "command": "webdav.connect",
      "when": "false"  // 不在命令面板中显示
    }
  ]
}
```

## 脚本配置

### 开发脚本
```json
{
  "scripts": {
    "vscode:prepublish": "npm run compile",    // 发布前编译
    "compile": "tsc -p ./",                   // TypeScript编译
    "watch": "tsc -watch -p ./",              // 监听模式编译
    "build": "npm run compile",               // 构建
    "package": "vsce package",                // 打包扩展
    "lint": "eslint src --ext ts",            // 代码检查
    "pretest": "npm run compile && npm run lint"  // 测试前准备
  }
}
```

## 依赖配置

### 开发依赖
```json
{
  "devDependencies": {
    "@types/vscode": "^1.80.0",           // VSCode API类型
    "@types/node": "18.x",                 // Node.js类型
    "@typescript-eslint/eslint-plugin": "^6.13.0", // ESLint TypeScript插件
    "@typescript-eslint/parser": "^6.13.0",       // ESLint TypeScript解析器
    "eslint": "^8.54.0",                  // ESLint
    "typescript": "^5.3.0",               // TypeScript编译器
    "@vscode/test-electron": "^2.3.9"      // VSCode测试框架
  }
}
```

### 运行时依赖
```json
{
  "dependencies": {
    "webdav": "^4.11.4",  // WebDAV客户端库
    "axios": "^1.6.7"     // HTTP客户端库
  }
}
```

## 发布信息

### 仓库配置
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/OllieHu/webdav-markdown-manager.git"
  }
}
```

