// Content Script - runs in extension context with elevated privileges
// Can fetch local files (file:// protocol)

// Helper function to get i18n message
function i18n(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

// Progress panel functions
let logsWindowElement = null;
let hideProgressTimer = null;
let logMessages = [];

function createLogsWindow() {
  if (logsWindowElement) return logsWindowElement;
  
  logMessages = []; // 重置日志
  
  logsWindowElement = document.createElement('gemini-downloader-logs');
  logsWindowElement.style.cssText = 'all: initial !important;';
  
  const shadowRoot = logsWindowElement.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .panel {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 2147483647;
      width: 260px;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.8);
      overflow: hidden;
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    .header {
      background: rgba(255,255,255,0.05);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .icon {
      width: 18px;
      height: 18px;
      background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
    }
    .title {
      font-weight: 500;
      font-size: 11px;
      color: rgba(255,255,255,0.9);
      flex: 1;
    }
    .spinner {
      width: 12px;
      height: 12px;
      border: 1.5px solid rgba(255,255,255,0.15);
      border-top-color: #e94560;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .spinner.done {
      border-color: #4ade80;
      border-top-color: #4ade80;
      animation: none;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .logs {
      padding: 8px 12px;
      max-height: 140px;
      overflow-y: auto;
    }
    .logs::-webkit-scrollbar {
      width: 3px;
    }
    .logs::-webkit-scrollbar-track {
      background: rgba(255,255,255,0.03);
    }
    .logs::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.15);
      border-radius: 2px;
    }
    .log-item {
      padding: 4px 0;
      display: flex;
      align-items: flex-start;
      gap: 6px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .log-item:last-child {
      border-bottom: none;
    }
    .log-icon {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      border-radius: 50%;
    }
    .log-icon.info { background: rgba(59, 130, 246, 0.8); }
    .log-icon.success { background: rgba(34, 197, 94, 0.8); }
    .log-icon.current { background: rgba(245, 158, 11, 0.9); }
    .log-text {
      flex: 1;
      line-height: 1.3;
      word-break: break-word;
    }
    .log-item.current .log-text {
      color: rgba(255,255,255,0.95);
      font-weight: 500;
    }
    .progress-bar {
      height: 2px;
      background: rgba(255,255,255,0.08);
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, rgba(233, 69, 96, 0.8) 0%, rgba(255, 107, 107, 0.8) 100%);
      transition: width 0.3s ease;
      width: 0%;
    }
  `;
  shadowRoot.appendChild(style);
  
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="header">
      <div class="icon">📥</div>
      <div class="title">${i18n('progressTitle')}</div>
      <div class="spinner"></div>
    </div>
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
    <div class="logs"></div>
  `;
  shadowRoot.appendChild(panel);
  
  document.documentElement.appendChild(logsWindowElement);
  return logsWindowElement;
}

function showProgress(message, type = 'info') {
  const element = createLogsWindow();
  const shadowRoot = element.shadowRoot;
  const logsContainer = shadowRoot.querySelector('.logs');
  const progressFill = shadowRoot.querySelector('.progress-fill');
  const spinner = shadowRoot.querySelector('.spinner');
  
  // 清除之前的隐藏定时器
  if (hideProgressTimer) {
    clearTimeout(hideProgressTimer);
    hideProgressTimer = null;
  }
  
  // 解析步骤进度 (支持中英文: "Step 1/4" 或 "步骤 1/4")
  const stepMatch = message.match(/(?:Step|步骤)\s*(\d+)\/(\d+)/i);
  if (stepMatch) {
    const current = parseInt(stepMatch[1]);
    const total = parseInt(stepMatch[2]);
    const percent = (current / total) * 100;
    progressFill.style.width = `${percent}%`;
  }
  
  // 更新之前的日志项状态
  const existingItems = logsContainer.querySelectorAll('.log-item');
  existingItems.forEach(item => {
    item.classList.remove('current');
    const icon = item.querySelector('.log-icon');
    if (icon.classList.contains('current')) {
      icon.classList.remove('current');
      icon.classList.add('success');
      icon.textContent = '✓';
    }
  });
  
  // 添加新日志
  const logItem = document.createElement('div');
  logItem.className = 'log-item current';
  
  const iconClass = type === 'success' ? 'success' : 'current';
  const iconText = type === 'success' ? '✓' : '●';
  
  logItem.innerHTML = `
    <div class="log-icon ${iconClass}">${iconText}</div>
    <div class="log-text">${message}</div>
  `;
  logsContainer.appendChild(logItem);
  
  // 滚动到底部
  logsContainer.scrollTop = logsContainer.scrollHeight;
  
  // 如果是成功状态，停止spinner
  if (type === 'success' && (message.includes('Step 4/4') || message.includes('步骤 4/4'))) {
    spinner.classList.add('done');
    progressFill.style.width = '100%';
  }
}

function hideProgress(delay = 0) {
  if (hideProgressTimer) {
    clearTimeout(hideProgressTimer);
  }
  hideProgressTimer = setTimeout(() => {
    if (logsWindowElement) {
      const panel = logsWindowElement.shadowRoot.querySelector('.panel');
      if (panel) {
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(20px)';
        setTimeout(() => {
          if (logsWindowElement) {
            logsWindowElement.remove();
            logsWindowElement = null;
            logMessages = [];
          }
        }, 300);
      }
    }
  }, delay);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getFrameContent") {
    sendResponse({
      html: document.documentElement.outerHTML,
      title: document.title,
      url: location.href,
    });
    return true;
  }

  if (request.action === "collectAndDownloadResources") {
    // 异步处理
    handleCollectAndDownload(request.isLocalFile)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true; // 保持消息通道打开
  }

  if (request.action === "fetchResources") {
    // 使用 Content Script 特权下载资源
    handleFetchResources(request.urls, request.type)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === "generateHtml") {
    // 生成最终 HTML
    handleGenerateHtml(request.resourceMap, request.cssMap, request.jsMap, request.genPromptToUrlMap || {}, request.blobToBase64Map || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === "showNotification") {
    // 显示通知
    showToast(request.message, request.type);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "showUploadProgress") {
    // 显示上传进度（使用同一个进度面板）
    showUploadInMainPanel(request.status, request.message, request.url);
    sendResponse({ success: true });
    return true;
  }
});

// 在主进度面板中显示上传进度
function showUploadInMainPanel(status, message, url = '') {
  const element = createLogsWindow();
  const shadowRoot = element.shadowRoot;
  const logsContainer = shadowRoot.querySelector('.logs');
  const progressFill = shadowRoot.querySelector('.progress-fill');
  const spinner = shadowRoot.querySelector('.spinner');
  const titleEl = shadowRoot.querySelector('.title');
  
  // 清除之前的隐藏定时器
  if (hideProgressTimer) {
    clearTimeout(hideProgressTimer);
    hideProgressTimer = null;
  }
  
  // 更新标题
  const statusTitles = {
    uploading: '☁️ ' + i18n('progressTitle'),
    processing: '⚙️ Processing',
    success: '✓ Published!',
    error: '✗ Failed',
  };
  titleEl.textContent = statusTitles[status] || statusTitles.uploading;
  
  // 更新进度条
  if (status === 'uploading') {
    progressFill.style.width = '70%';
  } else if (status === 'processing') {
    progressFill.style.width = '85%';
  } else if (status === 'success') {
    progressFill.style.width = '100%';
    spinner.classList.add('done');
  } else if (status === 'error') {
    progressFill.style.width = '100%';
    progressFill.style.background = 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)';
  }
  
  // 更新之前的日志项状态
  const existingItems = logsContainer.querySelectorAll('.log-item');
  existingItems.forEach(item => {
    item.classList.remove('current');
    const icon = item.querySelector('.log-icon');
    if (icon && icon.classList.contains('current')) {
      icon.classList.remove('current');
      icon.classList.add('success');
      icon.textContent = '✓';
    }
  });
  
  // 添加新日志
  const logItem = document.createElement('div');
  logItem.className = 'log-item current';
  
  let iconClass = 'current';
  let iconText = '●';
  if (status === 'success') {
    iconClass = 'success';
    iconText = '✓';
  } else if (status === 'error') {
    iconClass = 'info';
    iconText = '✗';
  }
  
  logItem.innerHTML = `
    <div class="log-icon ${iconClass}">${iconText}</div>
    <div class="log-text">${message}</div>
  `;
  logsContainer.appendChild(logItem);
  
  // 如果有 URL，添加链接
  if (url && status === 'success') {
    const linkItem = document.createElement('div');
    linkItem.className = 'log-item';
    linkItem.innerHTML = `
      <div class="log-icon success">🔗</div>
      <div class="log-text"><a href="${url}" target="_blank" style="color: #4ade80; text-decoration: none;">Open Demo →</a></div>
    `;
    logsContainer.appendChild(linkItem);
  }
  
  // 滚动到底部
  logsContainer.scrollTop = logsContainer.scrollHeight;
  
  // 成功或失败后延迟关闭
  if (status === 'success' || status === 'error') {
    hideProgress(status === 'success' && url ? 5000 : 3000);
  }
}

// 显示 Toast 通知
function showToast(message, type = 'info') {
  // 创建或获取 toast 容器
  let toastContainer = document.querySelector('gemini-downloader-toast');
  if (!toastContainer) {
    toastContainer = document.createElement('gemini-downloader-toast');
    toastContainer.style.cssText = 'all: initial !important;';
    const shadowRoot = toastContainer.attachShadow({ mode: 'open' });
    
    const style = document.createElement('style');
    style.textContent = `
      .toast {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        padding: 14px 20px;
        border-radius: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.25);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .toast.success {
        background: rgba(16, 185, 129, 0.95);
        color: white;
      }
      .toast.error {
        background: rgba(239, 68, 68, 0.95);
        color: white;
      }
      .toast.info {
        background: rgba(59, 130, 246, 0.95);
        color: white;
      }
      .icon {
        font-size: 18px;
      }
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes fadeOut {
        to {
          opacity: 0;
          transform: translateY(-10px);
        }
      }
    `;
    shadowRoot.appendChild(style);
    document.documentElement.appendChild(toastContainer);
  }
  
  const shadowRoot = toastContainer.shadowRoot;
  
  // 移除旧的 toast
  const oldToast = shadowRoot.querySelector('.toast');
  if (oldToast) {
    oldToast.remove();
  }
  
  // 创建新的 toast
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <span class="icon">${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;
  
  shadowRoot.appendChild(toast);
  
  // 3秒后自动移除
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// 收集页面中的资源 URL
async function handleCollectAndDownload(isLocalFile) {
  try {
    const imageUrls = new Set();
    const cssUrls = new Set();
    const jsUrls = new Set();

    // 收集 Gemini 动态图片映射（/gen?prompt=... -> 实际图片 URL）
    // 注意：Content Script 运行在隔离世界，无法直接访问页面变量
    // 需要从脚本的文本内容中解析 IMG_GEN_REPLACE_MAP
    showProgress(i18n('progressStep1'), 'info');
    
    const genPromptToUrlMap = {};
    const injectedScripts = document.querySelectorAll('script[class^="injected-"]');
    for (const script of injectedScripts) {
      const content = script.textContent || "";
      // 匹配 IMG_GEN_REPLACE_MAP = {...} 或 const IMG_GEN_REPLACE_MAP = {...}
      const match = content.match(/IMG_GEN_REPLACE_MAP\s*=\s*(\{[^;]+\})/);
      if (match) {
        try {
          const map = JSON.parse(match[1]);
          for (const [prompt, url] of Object.entries(map)) {
            genPromptToUrlMap[prompt] = url;
            // 把实际的图片 URL 也加入下载列表
            if (url && !url.startsWith("data:")) {
              imageUrls.add(url);
            }
          }
        } catch (e) {
          // 忽略解析失败
        }
      }
    }

    // 收集 blob URL 图片并转换为 base64（blob URL 是临时的，保存后会失效）
    const blobToBase64Map = {};
    const blobImages = document.querySelectorAll("img[src^='blob:']");
    for (const img of blobImages) {
      const blobUrl = img.src;
      try {
        const base64 = await convertImageToBase64(img);
        if (base64) {
          blobToBase64Map[blobUrl] = base64;
        }
      } catch (e) {
        // 忽略转换失败
      }
    }

    // 收集图片（排除 blob: 和 data:）
    for (const img of document.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("data:") && !src.startsWith("blob:")) {
        imageUrls.add(new URL(src, location.href).href);
      }
    }

    // 收集 picture source
    for (const source of document.querySelectorAll("source[srcset]")) {
      const srcset = source.getAttribute("srcset");
      if (srcset) {
        const parts = srcset.split(",");
        for (const part of parts) {
          const match = part.trim().match(/^(\S+)/);
          if (match && !match[1].startsWith("data:")) {
            imageUrls.add(new URL(match[1], location.href).href);
          }
        }
      }
    }

    // 收集 favicon
    for (const favicon of document.querySelectorAll(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
    )) {
      const href = favicon.getAttribute("href");
      if (href && !href.startsWith("data:")) {
        imageUrls.add(new URL(href, location.href).href);
      }
    }

    // 收集外链 CSS
    for (const link of document.querySelectorAll(
      'link[rel="stylesheet"][href]'
    )) {
      const href = link.getAttribute("href");
      if (href && !href.startsWith("data:")) {
        cssUrls.add(new URL(href, location.href).href);
      }
    }

    // 收集外链 JS
    for (const script of document.querySelectorAll("script[src]")) {
      const src = script.getAttribute("src");
      if (src && !src.startsWith("data:")) {
        jsUrls.add(new URL(src, location.href).href);
      }
    }

    // 收集内联样式中的背景图片 URL
    for (const el of document.querySelectorAll("[style]")) {
      const style = el.getAttribute("style");
      if (style) {
        const urlMatches = style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g);
        for (const match of urlMatches) {
          if (!match[1].startsWith("data:")) {
            imageUrls.add(new URL(match[1], location.href).href);
          }
        }
      }
    }

    // 收集 style 标签中的背景图片 URL
    for (const styleTag of document.querySelectorAll("style")) {
      const content = styleTag.textContent;
      if (content) {
        const urlMatches = content.matchAll(
          /url\(\s*["']?([^"')]+)["']?\s*\)/g
        );
        for (const match of urlMatches) {
          if (!match[1].startsWith("data:")) {
            imageUrls.add(new URL(match[1], location.href).href);
          }
        }
      }
    }

    return {
      imageUrls: [...imageUrls],
      cssUrls: [...cssUrls],
      jsUrls: [...jsUrls],
      genPromptToUrlMap, // Gemini 动态图片映射
      blobToBase64Map, // blob URL -> base64 映射
      baseUrl: location.href,
      title: document.title || "Untitled",
      error: null,
    };
  } catch (err) {
    return {
      imageUrls: [],
      cssUrls: [],
      jsUrls: [],
      genPromptToUrlMap: {},
      blobToBase64Map: {},
      baseUrl: location.href,
      title: null,
      error: err.message,
    };
  }
}

// 将图片元素转换为 base64（用于 blob URL 图片）
async function convertImageToBase64(img) {
  const src = img.currentSrc || img.src;
  if (!src) return null;

  // 尝试使用 Canvas（已加载且非跨域的图片）
  if (img.complete && img.naturalWidth > 0) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl) return dataUrl;
    } catch (e) {
      console.warn("Canvas 转换失败（可能是跨域图片）:", e);
    }
  }

  // Canvas 失败时，直接 fetch Blob URL 再转成 base64
  try {
    const response = await fetch(src, { cache: "force-cache" });
    if (response.ok) {
      const blob = await response.blob();
      return await blobToBase64(blob);
    }
  } catch (e) {
    console.warn("Fetch Blob 转换失败:", e);
  }

  return null;
}

// 使用 Content Script 特权下载资源
async function handleFetchResources(urls, type) {
  const results = {};
  const total = urls.length;
  let completed = 0;
  
  const typeLabel = type === 'base64' ? i18n('resourceImages') : type === 'css' ? i18n('resourceCSS') : i18n('resourceJS');
  showProgress(chrome.i18n.getMessage('progressStep2', [typeLabel, '0', String(total)]), 'info');

  await Promise.all(
    urls.map(async (url) => {
      try {
        if (type === "base64") {
          const data = await fetchAsBase64(url);
          if (data) {
            results[url] = data;
          }
        } else if (type === "text") {
          const data = await fetchAsText(url);
          if (data) {
            results[url] = data;
          }
        } else if (type === "css") {
          // CSS 需要处理其中的 url() 引用
          const cssText = await fetchAsText(url);
          if (cssText) {
            const processedCss = await processCssUrls(cssText, url);
            results[url] = processedCss;
          }
        }
      } catch (err) {
        // 忽略下载失败
      }
      completed++;
      // 每下载 10 个更新一次进度
      if (completed % 10 === 0 || completed === total) {
        showProgress(chrome.i18n.getMessage('progressStep2', [typeLabel, String(completed), String(total)]), 'info');
      }
    })
  );

  return results;
}

// Fetch 资源为 base64（Content Script 有扩展特权）
async function fetchAsBase64(url) {
  // 策略：先尝试带 credentials，失败后不带（处理 CORS 问题）
  
  // 尝试1：带 credentials（用于需要认证的资源，如 Google 图片）
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "include",
    });
    if (response.ok) {
      const blob = await response.blob();
      return blobToBase64(blob);
    }
  } catch (err) {
    // CORS 错误会抛出异常，继续尝试不带 credentials
    console.log(`Credentials failed, retrying without: ${url}`);
  }

  // 尝试2：不带 credentials（避免 CORS 的 wildcard 问题）
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "omit",
    });
    if (response.ok) {
      const blob = await response.blob();
      return blobToBase64(blob);
    }
    console.warn(`Fetch failed ${url}: ${response.status}`);
  } catch (err) {
    console.warn(`Error fetching ${url}:`, err.message);
  }

  return null;
}

// Fetch 资源为文本
async function fetchAsText(url) {
  // 策略：先尝试带 credentials，失败后不带（处理 CORS 问题）
  
  // 尝试1：带 credentials
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "include",
    });
    if (response.ok) {
      return response.text();
    }
  } catch (err) {
    // CORS 错误会抛出异常，继续尝试不带 credentials
    console.log(`Credentials failed, retrying without: ${url}`);
  }

  // 尝试2：不带 credentials
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "omit",
    });
    if (response.ok) {
      return response.text();
    }
    console.warn(`Fetch failed ${url}: ${response.status}`);
  } catch (err) {
    console.warn(`Error fetching ${url}:`, err.message);
  }

  return null;
}

// Blob 转 base64
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

// 处理 CSS 中的 url() 引用
async function processCssUrls(cssContent, cssBaseUrl) {
  const urlRegex = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
  const urlMap = new Map();

  // 收集所有 URL
  let match;
  while ((match = urlRegex.exec(cssContent)) !== null) {
    const url = match[1];
    if (!url.startsWith("data:") && !urlMap.has(url)) {
      try {
        const absoluteUrl = new URL(url, cssBaseUrl).href;
        urlMap.set(url, absoluteUrl);
      } catch {
        // 忽略无效 URL
      }
    }
  }

  // 下载所有资源
  const base64Map = new Map();
  await Promise.all(
    [...urlMap.entries()].map(async ([originalUrl, absoluteUrl]) => {
      try {
        const base64 = await fetchAsBase64(absoluteUrl);
        if (base64) {
          base64Map.set(originalUrl, base64);
        }
      } catch {
        // 忽略下载失败
      }
    })
  );

  // 替换 URL
  return cssContent.replace(urlRegex, (match, url) => {
    const base64 = base64Map.get(url);
    if (base64) {
      return `url("${base64}")`;
    }
    return match;
  });
}

// 生成最终 HTML
async function handleGenerateHtml(resourceMap, cssMap, jsMap, genPromptToUrlMap = {}, blobToBase64Map = {}) {
  try {
    showProgress(i18n('progressStep3'), 'info');
    const docClone = document.cloneNode(true);

    // 移除进度面板（不要保存到文件中）
    const progressPanelClone = docClone.getElementById('gemini-downloader-progress');
    if (progressPanelClone) {
      progressPanelClone.remove();
    }

    // 替换 blob URL 图片为 base64
    let blobReplaced = 0;
    for (const img of docClone.querySelectorAll("img[src^='blob:']")) {
      const blobUrl = img.getAttribute("src");
      if (blobToBase64Map[blobUrl]) {
        img.setAttribute("src", blobToBase64Map[blobUrl]);
        blobReplaced++;
        // 标记为已下载，防止 inject 脚本再处理
        img.setAttribute("data-downloaded", "true");
        // 移除可能触发 inject 脚本的属性
        img.removeAttribute("go-data-src");
        img.removeAttribute("data-src");
        img.removeAttribute("data-lazy-src");
        console.log(`[Blob] 替换成功: ${blobUrl.substring(0, 50)}...`);
      }
    }

    // 替换普通图片 src，并清理可能触发 inject 脚本的属性
    for (const img of docClone.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      // 跳过已处理的（data: 开头）和 blob:
      if (src && !src.startsWith("data:") && !src.startsWith("blob:")) {
        const absoluteUrl = new URL(src, location.href).href;
        if (resourceMap[absoluteUrl]) {
          img.setAttribute("src", resourceMap[absoluteUrl]);
          // 标记为已下载，防止 inject 脚本再处理
          img.setAttribute("data-downloaded", "true");
          // 移除可能触发 inject 脚本的属性
          img.removeAttribute("go-data-src");
          img.removeAttribute("data-src");
          img.removeAttribute("data-lazy-src");
        }
      }
    }

    // 替换 picture source srcset
    for (const source of docClone.querySelectorAll("source[srcset]")) {
      const srcset = source.getAttribute("srcset");
      if (srcset) {
        const parts = srcset.split(",");
        const newParts = [];
        for (const part of parts) {
          const trimmed = part.trim();
          const match = trimmed.match(/^(\S+)(.*)$/);
          if (match) {
            const url = match[1];
            const rest = match[2];
            if (!url.startsWith("data:")) {
              const absoluteUrl = new URL(url, location.href).href;
              if (resourceMap[absoluteUrl]) {
                newParts.push(resourceMap[absoluteUrl] + rest);
              } else {
                newParts.push(trimmed);
              }
            } else {
              newParts.push(trimmed);
            }
          }
        }
        source.setAttribute("srcset", newParts.join(", "));
      }
    }

    // 替换 favicon
    for (const favicon of docClone.querySelectorAll(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
    )) {
      const href = favicon.getAttribute("href");
      if (href && !href.startsWith("data:")) {
        const absoluteUrl = new URL(href, location.href).href;
        if (resourceMap[absoluteUrl]) {
          favicon.setAttribute("href", resourceMap[absoluteUrl]);
        }
      }
    }

    // 替换外链 CSS 为内联 style
    for (const link of docClone.querySelectorAll(
      'link[rel="stylesheet"][href]'
    )) {
      const href = link.getAttribute("href");
      if (href && !href.startsWith("data:")) {
        const absoluteUrl = new URL(href, location.href).href;
        if (cssMap[absoluteUrl]) {
          const style = docClone.createElement("style");
          style.textContent = cssMap[absoluteUrl];
          const media = link.getAttribute("media");
          if (media) {
            style.setAttribute("media", media);
          }
          link.parentNode.replaceChild(style, link);
        }
      }
    }

    // 替换外链 JS 为内联 script
    for (const script of docClone.querySelectorAll("script[src]")) {
      const src = script.getAttribute("src");
      if (src && !src.startsWith("data:")) {
        const absoluteUrl = new URL(src, location.href).href;
        if (jsMap[absoluteUrl]) {
          const newScript = docClone.createElement("script");
          newScript.textContent = jsMap[absoluteUrl];
          const type = script.getAttribute("type");
          if (type && type !== "text/javascript") {
            newScript.setAttribute("type", type);
          }
          for (const attr of ["defer", "async", "nomodule"]) {
            if (script.hasAttribute(attr)) {
              newScript.setAttribute(attr, script.getAttribute(attr));
            }
          }
          script.parentNode.replaceChild(newScript, script);
        }
      }
    }

    // 禁用 Gemini 注入脚本
    // 因为我们已经把所有图片（包括 blob URL）都处理成 base64 了
    // 不需要 inject 脚本再做替换，反而它会把已处理的图片改回占位符
    const injectedScripts = docClone.querySelectorAll('script[class^="injected-"]');
    console.log(`[Inject] Found ${injectedScripts.length} injected scripts, disabling them`);
    for (const script of injectedScripts) {
      script.setAttribute("type", "text/plain");
      script.setAttribute("data-disabled-by-extension", "true");
    }

    // 替换内联样式中的背景图片
    for (const el of docClone.querySelectorAll("[style]")) {
      const style = el.getAttribute("style");
      if (style && style.includes("url(")) {
        const urlRegex = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
        const newStyle = style.replace(urlRegex, (match, url) => {
          if (!url.startsWith("data:")) {
            const absoluteUrl = new URL(url, location.href).href;
            if (resourceMap[absoluteUrl]) {
              return `url("${resourceMap[absoluteUrl]}")`;
            }
          }
          return match;
        });
        el.setAttribute("style", newStyle);
      }
    }

    // 替换 style 标签中的背景图片
    for (const styleTag of docClone.querySelectorAll("style")) {
      if (styleTag.textContent.includes("url(")) {
        const urlRegex = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
        styleTag.textContent = styleTag.textContent.replace(
          urlRegex,
          (match, url) => {
            if (!url.startsWith("data:")) {
              const absoluteUrl = new URL(url, location.href).href;
              if (resourceMap[absoluteUrl]) {
                return `url("${resourceMap[absoluteUrl]}")`;
              }
            }
            return match;
          }
        );
      }
    }

    // 生成最终 HTML
    const doctype = "<!DOCTYPE html>\n";
    const html = doctype + docClone.documentElement.outerHTML;

    const sizeKB = Math.round(html.length / 1024);
    showProgress(chrome.i18n.getMessage('progressStep4', [String(sizeKB)]), 'success');
    hideProgress(2000);

    return { html, title: document.title || "Untitled", error: null };
  } catch (err) {
    return { html: null, title: null, error: err.message };
  }
}
