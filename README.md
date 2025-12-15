# Gemini Dynamic View Downloader

一款 Chrome 扩展，用于保存 Google Gemini 生成的动态视图（Generative UI）为完整的 HTML 文件。

## ✨ 功能特性

- 📥 **一键保存** - 右键点击 iframe 即可保存为 HTML 文件
- 🖼️ **图片内嵌** - 自动下载图片并转换为 base64，确保离线可用
- 🚫 **脚本禁用** - 自动禁用 Gemini 注入的替换脚本，保持图片正常显示
- 🌐 **导出到服务器** - 可选配置，将内容发送到自定义服务器
- 💬 **实时状态** - 页面左下角显示处理进度

## 📦 安装

1. 下载或克隆本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目文件夹

## 🚀 使用方法

### 保存到本地

1. 在 Gemini 页面中，找到动态视图的 iframe
2. 在 iframe 内右键点击
3. 选择「**保存此框架为 HTML**」
4. 文件会自动保存到下载目录

### 导出到服务器

1. 右键点击扩展图标 → 选项（或在扩展管理页点击「详情」→「扩展程序选项」）
2. 配置服务器地址和口令
3. 保存设置后，右键菜单会出现「**导出到服务器**」选项
4. 如果服务器导出失败，会自动回退到本地保存

## ⚙️ 配置说明

| 配置项 | 说明 |
|--------|------|
| 服务器地址 | HTTP(S) 接口地址，如 `http://localhost:3000/api/upload` |
| 服务器口令 | 用于验证的 token，会作为 `Authorization: Bearer {口令}` 发送 |

## 🔌 服务器接口

```http
POST /api/upload
Content-Type: application/json
Authorization: Bearer {口令}

{
  "filename": "gemini-view-2025-01-01T12-00-00.html",
  "title": "页面标题",
  "html": "<!DOCTYPE html>..."
}
```

### 响应

- `200 OK` - 导出成功
- 其他状态码 - 导出失败，扩展会自动回退到本地保存

## 📁 项目结构

```
gemini-dynamic-view-downloader/
├── manifest.json      # 扩展配置
├── background.js      # 后台服务脚本
├── content.js         # 内容脚本
├── options.html       # 设置页面
├── options.js         # 设置逻辑
└── icons/             # 扩展图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 🔧 技术细节

- **Manifest V3** - 使用最新的 Chrome 扩展标准
- **Service Worker** - 后台脚本处理图片下载和 HTML 处理
- **MAIN World 注入** - 访问页面全局变量获取真实图片 URL
- **DOM 快照** - 保存当前渲染状态的完整 HTML

## 📝 注意事项

- 保存的是 DOM 快照，包含运行时状态
- 部分动态效果（如 PIXI.js 动画）可能无法完美还原
- 需要在 iframe 内右键点击才能看到保存选项

## 📄 License

MIT





