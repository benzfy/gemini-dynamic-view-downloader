// Content Script - 运行在扩展上下文，有更高的权限
// 可以 fetch 本地文件（file:// 协议）

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
    handleGenerateHtml(request.resourceMap, request.cssMap, request.jsMap, request.genPromptToUrlMap || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

// 收集页面中的资源 URL
async function handleCollectAndDownload(isLocalFile) {
  try {
    const imageUrls = new Set();
    const cssUrls = new Set();
    const jsUrls = new Set();

    // 收集 Gemini 动态图片映射（/gen?prompt=... -> 实际图片 URL）
    // 注意：Content Script 运行在隔离世界，无法直接访问页面变量
    // 需要从脚本的文本内容中解析 IMG_GEN_REPLACE_MAP
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
          showProgress(`发现 ${Object.keys(map).length} 个 Gemini 动态图片`, 'info');
        } catch (e) {
          showProgress('解析 IMG_GEN_REPLACE_MAP 失败', 'warn');
        }
      }
    }

    // 收集 blob URL 图片并转换为 base64（blob URL 是临时的，保存后会失效）
    showProgress('处理 Blob 图片...', 'info');
    const blobToBase64Map = {};
    const blobImages = document.querySelectorAll("img[src^='blob:']");
    let blobCount = 0;
    for (const img of blobImages) {
      const blobUrl = img.src;
      try {
        // 确保图片已加载
        if (img.complete && img.naturalWidth > 0) {
          const base64 = await convertImageToBase64(img);
          if (base64) {
            blobToBase64Map[blobUrl] = base64;
            blobCount++;
          }
        }
      } catch (e) {
        showProgress(`Blob 转换失败: ${blobUrl.substring(0, 30)}...`, 'warn');
      }
    }
    if (blobCount > 0) {
      showProgress(`已转换 ${blobCount} 个 Blob 图片`, 'success');
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

    showProgress(`收集完成: ${imageUrls.size} 图片, ${cssUrls.size} CSS, ${jsUrls.size} JS`, 'success');

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
    showProgress(`收集失败: ${err.message}`, 'error');
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
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      // 尝试用 PNG 格式（无损）
      const dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    } catch (e) {
      console.warn("Canvas 转换失败（可能是跨域图片）:", e);
      resolve(null);
    }
  });
}

// 使用 Content Script 特权下载资源
async function handleFetchResources(urls, type) {
  const results = {};
  const total = urls.length;
  let completed = 0;
  let failed = 0;
  
  const typeLabel = type === 'base64' ? '图片' : type === 'css' ? 'CSS' : 'JS';
  showProgress(`开始下载 ${total} 个${typeLabel}...`, 'info');

  await Promise.all(
    urls.map(async (url) => {
      try {
        if (type === "base64") {
          const data = await fetchAsBase64(url);
          if (data) {
            results[url] = data;
          } else {
            failed++;
          }
        } else if (type === "text") {
          const data = await fetchAsText(url);
          if (data) {
            results[url] = data;
          } else {
            failed++;
          }
        } else if (type === "css") {
          // CSS 需要处理其中的 url() 引用
          const cssText = await fetchAsText(url);
          if (cssText) {
            const processedCss = await processCssUrls(cssText, url);
            results[url] = processedCss;
          } else {
            failed++;
          }
        }
        completed++;
        // 每下载 5 个更新一次进度
        if (completed % 5 === 0 || completed === total) {
          showProgress(`${typeLabel}下载中: ${completed}/${total}`, 'info');
        }
      } catch (err) {
        completed++;
        failed++;
      }
    })
  );

  if (failed > 0) {
    showProgress(`${typeLabel}下载完成: ${total - failed}/${total} (${failed} 失败)`, 'warn');
  } else {
    showProgress(`${typeLabel}下载完成: ${total} 个`, 'success');
  }

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
    console.log(`带 credentials 失败，尝试不带: ${url}`);
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
    console.log(`带 credentials 失败，尝试不带: ${url}`);
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
    showProgress('生成离线 HTML...', 'info');
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
    console.log(`[Inject] 找到 ${injectedScripts.length} 个注入脚本，将禁用它们`);
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
    showProgress(`✅ 生成完成！文件大小: ${sizeKB} KB`, 'success');
    hideProgress(3000);

    return { html, title: document.title || "Untitled", error: null };
  } catch (err) {
    showProgress(`生成失败: ${err.message}`, 'error');
    return { html: null, title: null, error: err.message };
  }
}
