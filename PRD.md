# Gemini 动态视图下载器 - 浏览器扩展设计文档

## 项目目标

创建一个浏览器扩展，用于保存任意 iframe（特别是 Gemini 动态视图）的完整 HTML 内容为本地文件，并确保离线可用。

## 背景说明

### 什么是 Gemini 动态视图

Gemini 在对话中可以生成交互式的动态视图组件，这些组件以 iframe 的形式嵌入在对话响应中。其 HTML 结构如下：

```html
<generative-ui-frame _nghost-ng-c3338719906="" class="ng-star-inserted">
  <div _ngcontent-ng-c3338719906="" class="generative-ui-frame-container">
    <div _ngcontent-ng-c3338719906="" class="iframe-components-container done-generating">
      <div _ngcontent-ng-c3338719906="" class="iframe-container">
        <iframe 
          sandbox="allow-popups allow-downloads allow-same-origin allow-forms allow-popups-to-escape-sandbox allow-scripts" 
          src="https://xxx.scf.usercontent.goog/generative-ui-response/shim.html?origin=https%3A%2F%2Fgemini.google.com">
        </iframe>
      </div>
    </div>
  </div>
</generative-ui-frame>
```

### 关键特征

- **容器组件**: `<generative-ui-frame>` Angular 组件
- **iframe 容器**: `.iframe-container` 类
- **iframe sandbox**: 包含 `allow-same-origin`，允许内容脚本访问 ✅
- **域名格式**: `*.scf.usercontent.goog/generative-ui-response/shim.html`

### Gemini 动态视图的特殊处理需求

1. **图片资源**：动态视图中的图片来自 `lh3.googleusercontent.com` 等 Google 域名，需要**携带认证 Cookie** 才能访问
2. **注入脚本**：页面包含 `<script class="injected-xxx">` 脚本，这些脚本会在离线打开时将图片替换为占位符，需要禁用

## 核心功能

1. **右键菜单保存** - 在任意 iframe 内右键点击时，显示"保存此框架为 HTML"菜单项
2. **图片内嵌** - 自动下载图片并转为 base64 内嵌，实现完全离线可用
3. **禁用注入脚本** - 自动禁用 Gemini 的动态图片替换脚本
4. **智能文件命名** - 根据 iframe 内容的 title 或时间戳自动生成文件名
5. **完整 HTML 保存** - 保存完整的 DOCTYPE、html、head、body 结构

## 技术架构

### 文件结构

```
gemini-dynamic-view-downloader/
├── manifest.json          # 扩展配置 (Manifest V3)
├── background.js          # Service Worker，处理右键菜单和下载
├── content.js             # 内容脚本（备用）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### manifest.json 配置

```json
{
  "manifest_version": 3,
  "name": "Gemini Dynamic View Downloader",
  "version": "1.0.0",
  "description": "一键保存 Gemini 动态视图为 HTML 文件",
  "permissions": [
    "contextMenus",
    "downloads",
    "activeTab",
    "scripting"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "all_frames": true
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 工作流程

```
用户在 iframe 内右键点击
        ↓
background.js 显示 "保存此框架为 HTML" 菜单项
        ↓
用户点击菜单项
        ↓
background.js 向目标 frame 注入处理函数
        ↓
注入函数收集所有图片URL
        ↓
注入函数使用 fetch (credentials: include) 下载图片
        ↓
注入函数将图片转为 base64
        ↓
注入函数禁用 injected 脚本
        ↓
注入函数替换HTML中的图片URL为base64
        ↓
返回处理后的 HTML 给 background.js
        ↓
background.js 使用 chrome.downloads.download() 保存文件
```

## 关键代码逻辑

### 图片下载（带认证Cookie）

```javascript
// 在页面上下文中执行，可以访问页面的 cookies
const response = await fetch(url, {
  cache: "force-cache",
  credentials: "include", // 关键：携带认证 Cookie
  referrerPolicy: "strict-origin-when-cross-origin"
});

const blob = await response.blob();
const dataUrl = await new Promise((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.readAsDataURL(blob);
});
```

### 禁用注入脚本

```javascript
// 匹配 <script class="injected-xxx"> 并改为 type="text/plain"
html = html.replace(
  /<script(\s+)class(\s*)=(\s*)"injected-/gi,
  '<script type="text/plain" data-disabled-by-extension="true"$1class$2=$3"injected-'
);
```

### 替换图片URL

```javascript
for (const [originalUrl, dataUrl] of imageMap) {
  const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  
  // 替换 img src
  html = html.replace(new RegExp(`src="${escapedUrl}"`, "g"), `src="${dataUrl}"`);
  
  // 替换 CSS background-image
  html = html.replace(new RegExp(`url\\("${escapedUrl}"\\)`, "g"), `url("${dataUrl}")`);
}
```

## 注意事项

### 为什么要在页面上下文中下载图片

Service Worker (background.js) 中的 `fetch` 无法携带页面的认证 Cookie 进行跨域请求。因此必须通过 `chrome.scripting.executeScript` 在页面上下文中执行图片下载，这样可以利用页面已有的 cookies。

### 安全性

由于 Gemini 动态视图的 iframe 包含 `allow-same-origin` sandbox 属性，内容脚本可以正常访问其 DOM 内容。

### 文件名处理

```javascript
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')  // 替换非法字符
    .replace(/\s+/g, '_')           // 空格转下划线
    .substring(0, 100);             // 限制长度
}
```

## 浏览器兼容性

- Chrome/Edge: Manifest V3 ✅
- Firefox: 需要 Manifest V2/V3 适配

## 测试用例

1. 在 Gemini 对话中生成一个包含图片的动态视图
2. 右键点击动态视图内容，验证菜单项显示
3. 点击保存，验证图片已内嵌为 base64
4. 验证 `<script class="injected-xxx">` 已被禁用
5. 断网后打开保存的 HTML，验证图片正常显示
6. 验证保存的 HTML 可以在浏览器中正常打开和交互
