// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

// 监听设置更新
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'settingsUpdated') {
    createContextMenus();
  }
});

// 创建/更新右键菜单
async function createContextMenus() {
  // 先移除所有菜单
  await chrome.contextMenus.removeAll();
  
  // 添加保存到本地的菜单
  chrome.contextMenus.create({
    id: "save-gemini-view",
    title: "保存此框架为 HTML",
    contexts: ["frame"]
  });
  
  // 检查是否配置了服务器地址
  const result = await chrome.storage.sync.get(['serverUrl']);
  if (result.serverUrl) {
    chrome.contextMenus.create({
      id: "export-to-server",
      title: "导出到服务器",
      contexts: ["frame"]
    });
  }
}

// 在页面中显示状态浮窗
async function showStatus(tabId, message, type = 'info') {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, msgType) => {
        // 获取或创建浮窗容器
        let container = document.getElementById('gemini-downloader-status');
        if (!container) {
          container = document.createElement('div');
          container.id = 'gemini-downloader-status';
          container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            font-size: 12px;
            max-width: 350px;
            background: #1a1a2e;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            color: #fff;
          `;
          
          // 标题栏
          const header = document.createElement('div');
          header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid #333;
          `;
          header.innerHTML = `
            <span style="font-weight: 600; color: #667eea;">Gemini Downloader</span>
            <span id="gemini-downloader-close" style="cursor: pointer; opacity: 0.5; font-size: 14px;">✕</span>
          `;
          container.appendChild(header);
          
          // 日志区域
          const logs = document.createElement('div');
          logs.id = 'gemini-downloader-logs';
          logs.style.cssText = `
            max-height: 150px;
            overflow-y: auto;
            line-height: 1.6;
          `;
          container.appendChild(logs);
          
          document.body.appendChild(container);
          
          // 关闭按钮
          document.getElementById('gemini-downloader-close').onclick = () => {
            container.remove();
          };
        }
        
        // 添加日志
        const logs = document.getElementById('gemini-downloader-logs');
        const line = document.createElement('div');
        
        const colors = {
          info: '#a0aec0',
          success: '#68d391',
          error: '#fc8181',
          warn: '#f6e05e'
        };
        const icons = {
          info: '⏳',
          success: '✅',
          error: '❌',
          warn: '⚠️'
        };
        
        line.style.color = colors[msgType] || colors.info;
        line.textContent = `${icons[msgType] || '•'} ${msg}`;
        logs.appendChild(line);
        logs.scrollTop = logs.scrollHeight;
        
        // 成功或错误后 3 秒自动关闭
        if (msgType === 'success' || msgType === 'error') {
          setTimeout(() => {
            const el = document.getElementById('gemini-downloader-status');
            if (el) el.remove();
          }, 3000);
        }
      },
      args: [message, type]
    });
  } catch (e) {
    console.log("[Gemini Downloader] Could not show status:", e);
  }
}

// 处理菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const isSaveLocal = info.menuItemId === "save-gemini-view";
  const isExportServer = info.menuItemId === "export-to-server";
  
  if (!isSaveLocal && !isExportServer) {
    return;
  }

  // 立即显示处理中状态
  await showStatus(tab.id, "开始处理...", "info");

  try {
    console.log("[Gemini Downloader] Starting...", info.menuItemId);
    
    // 获取处理后的 HTML
    await showStatus(tab.id, "收集页面内容...", "info");
    const { fullHtml, title, filename, imageCount } = await processFrameContent(info, tab);
    if (imageCount > 0) {
      await showStatus(tab.id, `已下载 ${imageCount} 张图片`, "info");
    }
    
    if (isSaveLocal) {
      // 保存到本地
      const blob = new Blob([fullHtml], { type: "text/html" });
      const blobDataUrl = await blobToDataUrl(blob);

      chrome.downloads.download({
        url: blobDataUrl,
        filename: filename,
        saveAs: false  // 直接保存，不弹出选择框
      });
      
      await showStatus(tab.id, `已保存: ${filename}`, "success");
      console.log("[Gemini Downloader] Saved to local!");
    } else if (isExportServer) {
      // 导出到服务器
      const result = await chrome.storage.sync.get(['serverUrl', 'serverToken']);
      if (!result.serverUrl) {
        console.error("[Gemini Downloader] No server URL configured");
        return;
      }
      
      console.log("[Gemini Downloader] Exporting to server:", result.serverUrl);
      
      let exportSuccess = false;
      try {
        const headers = {
          'Content-Type': 'application/json',
        };
        
        // 如果配置了口令，添加 Authorization 头
        if (result.serverToken) {
          headers['Authorization'] = `Bearer ${result.serverToken}`;
        }
        
        const response = await fetch(result.serverUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            filename: filename,
            title: title,
            html: fullHtml
          })
        });
        
        if (response.ok) {
          await showStatus(tab.id, `已导出到服务器: ${filename}`, "success");
          console.log("[Gemini Downloader] Exported to server successfully!");
          exportSuccess = true;
        } else {
          await showStatus(tab.id, `服务器返回错误: ${response.status}`, "warn");
          console.error("[Gemini Downloader] Server returned:", response.status, await response.text());
        }
      } catch (fetchError) {
        await showStatus(tab.id, `服务器连接失败`, "warn");
        console.error("[Gemini Downloader] Failed to export to server:", fetchError);
      }
      
      // Fallback: 如果服务器导出失败，下载到本地
      if (!exportSuccess) {
        console.log("[Gemini Downloader] Fallback: saving to local...");
        await showStatus(tab.id, "回退到本地保存...", "info");
        
        const blob = new Blob([fullHtml], { type: "text/html" });
        const blobDataUrl = await blobToDataUrl(blob);

        chrome.downloads.download({
          url: blobDataUrl,
          filename: filename,
          saveAs: false
        });
        
        await showStatus(tab.id, `已保存到本地: ${filename}`, "success");
        console.log("[Gemini Downloader] Fallback saved to local!");
      }
    }

  } catch (error) {
    await showStatus(tab.id, `错误: ${error.message}`, "error");
    console.error("[Gemini Downloader] Error:", error);
  }
});

// 处理 iframe 内容，返回处理后的 HTML
async function processFrameContent(info, tab) {
  // Step 1: 在页面上下文中收集 HTML 和图片 URL 映射
  console.log("[Gemini Downloader] Step 1: Collecting HTML and image URLs...");
  const collectResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [info.frameId] },
    func: collectImageUrls,
    world: "MAIN"  // 需要访问页面全局变量
  });

  if (!collectResults || !collectResults[0] || !collectResults[0].result) {
    throw new Error("Failed to collect image URLs");
  }

  const collectData = collectResults[0].result;
  let html = collectData.html;
  const title = collectData.title;
  const imageUrlMap = collectData.imageUrlMap;
  const bgUrls = collectData.bgUrls;
  
  console.log(`[Gemini Downloader] Collected ${Object.keys(imageUrlMap).length} image mappings`);

  // Step 2: 在 background 中下载图片（不受 CORS 限制）
  console.log("[Gemini Downloader] Step 2: Downloading images in background...");
  const downloadedImages = {};
  
  for (const [originalSrc, realUrl] of Object.entries(imageUrlMap)) {
    try {
      const dataUrl = await fetchImageAsDataUrl(realUrl);
      if (dataUrl) {
        downloadedImages[originalSrc] = dataUrl;
        console.log(`[Gemini Downloader] Downloaded: ${realUrl.substring(0, 60)}...`);
      }
    } catch (error) {
      console.warn(`[Gemini Downloader] Failed to download: ${realUrl}`, error);
    }
  }
  
  // 下载背景图片
  const downloadedBgImages = {};
  for (const url of bgUrls) {
    try {
      const dataUrl = await fetchImageAsDataUrl(url);
      if (dataUrl) {
        downloadedBgImages[url] = dataUrl;
        console.log(`[Gemini Downloader] Downloaded bg: ${url.substring(0, 60)}...`);
      }
    } catch (error) {
      console.warn(`[Gemini Downloader] Failed to download bg: ${url}`, error);
    }
  }

  console.log(`[Gemini Downloader] Downloaded ${Object.keys(downloadedImages).length} images`);

  // Step 3: 处理 HTML，替换图片 URL
  let processedHtml = html;
  
  // 禁用注入脚本
  processedHtml = processedHtml.replace(
    /<script(\s+)class(\s*)=(\s*)injected-/gi,
    '<script type="text/plain" data-disabled-by-extension="true"$1class$2=$3injected-'
  );
  processedHtml = processedHtml.replace(
    /<script(\s+)class(\s*)=(\s*)"injected-/gi,
    '<script type="text/plain" data-disabled-by-extension="true"$1class$2=$3"injected-'
  );
  processedHtml = processedHtml.replace(
    /<script(\s+)class(\s*)=(\s*)'injected-/gi,
    '<script type="text/plain" data-disabled-by-extension="true"$1class$2=$3\'injected-'
  );
  console.log("[Gemini Downloader] Injected scripts disabled");

  // 替换 img src
  for (const [originalSrc, dataUrl] of Object.entries(downloadedImages)) {
    const escapedUrl = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    processedHtml = processedHtml.replace(new RegExp(`src="${escapedUrl}"`, "g"), `src="${dataUrl}"`);
    processedHtml = processedHtml.replace(new RegExp(`src='${escapedUrl}'`, "g"), `src='${dataUrl}'`);
  }

  // 替换背景图片
  for (const [originalUrl, dataUrl] of Object.entries(downloadedBgImages)) {
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    processedHtml = processedHtml.replace(new RegExp(`url\\("${escapedUrl}"\\)`, "g"), `url("${dataUrl}")`);
    processedHtml = processedHtml.replace(new RegExp(`url\\('${escapedUrl}'\\)`, "g"), `url('${dataUrl}')`);
    processedHtml = processedHtml.replace(new RegExp(`url\\(${escapedUrl}\\)`, "g"), `url(${dataUrl})`);
  }

  // 生成文件名
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
  const filename = sanitizeFilename(title !== "gemini-view" ? title : `gemini-view-${timestamp}`) + ".html";
  
  const fullHtml = `<!DOCTYPE html>\n${processedHtml}`;
  
  console.log("[Gemini Downloader] Processing done!");
  
  const imageCount = Object.keys(downloadedImages).length + Object.keys(downloadedBgImages).length;
  return { fullHtml, title, filename, imageCount };
}

// 在页面上下文中执行：收集图片 URL 映射
async function collectImageUrls() {
  console.log("========== [Gemini Downloader] Collecting URLs ==========");
  
  // 从 go-data-src 解析出查询 key
  function parseGoDataSrc(goDataSrc) {
    if (!goDataSrc) return null;
    
    if (goDataSrc.startsWith("/image?query=")) {
      const query = goDataSrc.substring("/image?query=".length);
      return decodeURIComponent(query.replace(/\+/g, " "));
    }
    
    if (goDataSrc.startsWith("/gen?prompt=")) {
      const params = new URLSearchParams(goDataSrc.substring("/gen?".length));
      let key = decodeURIComponent((params.get("prompt") || "").replace(/\+/g, " "));
      const aspect = params.get("aspect");
      const reimagine = params.get("reimagine");
      if (reimagine) {
        key += "&reimagine=" + reimagine;
      }
      if (aspect && aspect !== "1:1") {
        key += "&aspect=" + aspect;
      }
      return key;
    }
    
    return null;
  }
  
  // 获取全局变量
  let imgSearchReplaceMap = {};
  let imgGenReplaceMap = {};
  let imgSearchReimagineParam = "";
  
  if (typeof IMG_SEARCH_REPLACE_MAP !== "undefined") {
    imgSearchReplaceMap = IMG_SEARCH_REPLACE_MAP;
    console.log("[Gemini Downloader] IMG_SEARCH_REPLACE_MAP entries:", Object.keys(imgSearchReplaceMap).length);
  }
  
  if (typeof IMG_GEN_REPLACE_MAP !== "undefined") {
    imgGenReplaceMap = IMG_GEN_REPLACE_MAP;
    console.log("[Gemini Downloader] IMG_GEN_REPLACE_MAP entries:", Object.keys(imgGenReplaceMap).length);
    console.log("[Gemini Downloader] IMG_GEN_REPLACE_MAP keys:", Object.keys(imgGenReplaceMap));
  }
  
  if (typeof IMG_SEARCH_REIMAGINE_PARAM !== "undefined") {
    imgSearchReimagineParam = IMG_SEARCH_REIMAGINE_PARAM;
    console.log("[Gemini Downloader] IMG_SEARCH_REIMAGINE_PARAM:", imgSearchReimagineParam);
  }
  
  // 收集图片 URL 映射
  const imageUrlMap = {}; // originalSrc -> realUrl
  const imgs = document.querySelectorAll("img");
  
  console.log(`[Gemini Downloader] Found ${imgs.length} img elements`);
  
  for (const img of imgs) {
    const originalSrc = img.getAttribute("src") || "";
    const goDataSrc = img.getAttribute("go-data-src") || "";
    
    if (originalSrc.startsWith("data:")) continue;
    
    let realUrl = null;
    
    if (originalSrc.startsWith("http://") || originalSrc.startsWith("https://")) {
      realUrl = originalSrc;
    } else if (originalSrc.startsWith("blob:") && goDataSrc) {
      const key = parseGoDataSrc(goDataSrc);
      console.log(`[Gemini Downloader] go-data-src: ${goDataSrc} -> key: ${key}`);
      
      if (key) {
        if (imgSearchReplaceMap[key]) {
          const entry = imgSearchReplaceMap[key];
          realUrl = Array.isArray(entry) ? entry[0] : entry;
          console.log("[Gemini Downloader] Found in IMG_SEARCH_REPLACE_MAP");
        } else if (imgGenReplaceMap[key]) {
          realUrl = imgGenReplaceMap[key];
          console.log("[Gemini Downloader] Found in IMG_GEN_REPLACE_MAP");
        } else if (goDataSrc.startsWith("/image?query=") && imgSearchReimagineParam) {
          const keyWithReimagine = key + "&reimagine=" + imgSearchReimagineParam;
          console.log("[Gemini Downloader] Trying with reimagine:", keyWithReimagine);
          if (imgGenReplaceMap[keyWithReimagine]) {
            realUrl = imgGenReplaceMap[keyWithReimagine];
            console.log("[Gemini Downloader] Found with reimagine suffix!");
          }
        }
        
        if (realUrl) {
          console.log(`[Gemini Downloader] ✓ ${key.substring(0, 40)}... -> ${realUrl.substring(0, 60)}...`);
        } else {
          console.warn(`[Gemini Downloader] ✗ No mapping for: ${key}`);
        }
      }
    }
    
    if (realUrl) {
      imageUrlMap[originalSrc] = realUrl;
    }
  }
  
  // 收集背景图片 URL
  const bgUrls = [];
  document.querySelectorAll("*").forEach((el) => {
    const style = getComputedStyle(el);
    const bgImage = style.backgroundImage;
    if (bgImage && bgImage !== "none") {
      const match = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
      if (match && match[1]) {
        const url = match[1];
        if (url.startsWith("http://") || url.startsWith("https://")) {
          bgUrls.push(url);
        }
      }
    }
  });
  
  console.log(`[Gemini Downloader] Collected ${Object.keys(imageUrlMap).length} image mappings`);
  console.log(`[Gemini Downloader] Collected ${bgUrls.length} background images`);
  
  // 使用 DOM 快照
  const htmlToUse = document.documentElement.outerHTML;
  console.log(`[Gemini Downloader] Using DOM snapshot`);
  
  return {
    html: htmlToUse,
    title: document.title || "gemini-view",
    imageUrlMap: imageUrlMap,
    bgUrls: bgUrls
  };
}

// 在 background 中下载图片（不受 CORS 限制）
async function fetchImageAsDataUrl(url) {
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "include",
      referrerPolicy: "strict-origin-when-cross-origin"
    });
    
    if (!response.ok) {
      console.warn(`[Gemini Downloader] HTTP ${response.status} for ${url.substring(0, 60)}`);
      return null;
    }
    
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (error) {
    console.warn(`[Gemini Downloader] Fetch error: ${error.message}`);
    return null;
  }
}

// Blob 转 DataURL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 清理文件名
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}
