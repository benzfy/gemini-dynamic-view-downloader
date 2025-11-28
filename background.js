// 右键菜单 ID
const MENU_SAVE_WEB = "save-html-web";
const MENU_SAVE_SERVER_WEB = "save-server-web";

// 创建右键菜单 - 安装/更新时
chrome.runtime.onInstalled.addListener(() => {
  console.log("扩展安装/更新，创建菜单");
  createContextMenus();
});

// 浏览器启动时
chrome.runtime.onStartup.addListener(() => {
  console.log("浏览器启动，创建菜单");
  createContextMenus();
});

// Service Worker 启动时也要创建菜单
console.log("Service Worker 启动，创建菜单");
createContextMenus().catch((err) => console.error("创建菜单失败:", err));

// 监听设置更新
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "settingsUpdated") {
    createContextMenus();
  }
});

// 创建或更新右键菜单
async function createContextMenus() {
  try {
    await chrome.contextMenus.removeAll();

    // 保存为 HTML（在所有页面显示）
    chrome.contextMenus.create({
      id: MENU_SAVE_WEB,
      title: "保存页面为 HTML",
      contexts: ["page", "frame"],
    });

    // 检查是否配置了服务器
    const { serverUrl } = await chrome.storage.sync.get(["serverUrl"]);
    if (serverUrl) {
      chrome.contextMenus.create({
        id: MENU_SAVE_SERVER_WEB,
        title: "导出页面到服务器",
        contexts: ["page", "frame"],
      });
    }

    console.log("菜单创建成功");
  } catch (err) {
    console.error("创建菜单出错:", err);
  }
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SAVE_WEB) {
    await savePageAsHtml(info, tab, false);
  } else if (info.menuItemId === MENU_SAVE_SERVER_WEB) {
    await savePageAsHtml(info, tab, true);
  }
});

// 保存页面为 HTML
async function savePageAsHtml(info, tab, toServer) {
  try {
    const targetFrameId = info.frameId;
    const isLocalFile = tab.url && tab.url.startsWith("file://");

    console.log(
      `开始保存页面: ${tab.url}, frameId: ${targetFrameId}, isLocalFile: ${isLocalFile}`
    );

    // 步骤1：让 Content Script 收集资源 URL
    const collectResult = await sendMessageToFrame(
      tab.id,
      targetFrameId,
      {
        action: "collectAndDownloadResources",
        isLocalFile,
      }
    );

    if (collectResult.error) {
      console.error("资源收集失败:", collectResult.error);
      return;
    }

    const { imageUrls, cssUrls, jsUrls, genPromptToUrlMap, blobToBase64Map, title } = collectResult;
    console.log(
      `收集到: ${imageUrls.length} 个图片, ${cssUrls.length} 个 CSS, ${jsUrls.length} 个 JS, ${Object.keys(genPromptToUrlMap || {}).length} 个 Gemini 图片映射, ${Object.keys(blobToBase64Map || {}).length} 个 Blob 图片`
    );

    // 步骤2：让 Content Script 下载资源（利用扩展特权）
    const [imageMap, cssMap, jsMap] = await Promise.all([
      sendMessageToFrame(tab.id, targetFrameId, {
        action: "fetchResources",
        urls: imageUrls,
        type: "base64",
      }),
      sendMessageToFrame(tab.id, targetFrameId, {
        action: "fetchResources",
        urls: cssUrls,
        type: "css", // CSS 需要处理其中的 url()
      }),
      sendMessageToFrame(tab.id, targetFrameId, {
        action: "fetchResources",
        urls: jsUrls,
        type: "text",
      }),
    ]);

    console.log(
      `下载完成: ${Object.keys(imageMap).length} 个图片, ${Object.keys(cssMap).length} 个 CSS, ${Object.keys(jsMap).length} 个 JS`
    );

    // 步骤3：让 Content Script 生成最终 HTML
    const generateResult = await sendMessageToFrame(
      tab.id,
      targetFrameId,
      {
        action: "generateHtml",
        resourceMap: imageMap,
        cssMap: cssMap,
        jsMap: jsMap,
        genPromptToUrlMap: genPromptToUrlMap || {},
        blobToBase64Map: blobToBase64Map || {},
      }
    );

    if (generateResult.error) {
      console.error("HTML 生成失败:", generateResult.error);
      return;
    }

    const { html } = generateResult;

    // 生成文件名
    const filename = sanitizeFilename(title || "page") + ".html";

    if (toServer) {
      await uploadToServer(html, title, filename);
    } else {
      await downloadAsFile(html, filename);
    }

    console.log("保存完成:", filename);
  } catch (err) {
    console.error("保存失败:", err);
  }
}

// 发送消息到指定 frame（如果 Content Script 不存在，先注入）
async function sendMessageToFrame(tabId, frameId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, {
      frameId: frameId,
    });
    return response || {};
  } catch (err) {
    // Content Script 可能不存在，尝试注入
    if (err.message.includes("Could not establish connection")) {
      console.log("Content Script 不存在，尝试注入...");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId, frameIds: [frameId] },
          files: ["content.js"],
        });
        // 注入后重试发送消息
        const response = await chrome.tabs.sendMessage(tabId, message, {
          frameId: frameId,
        });
        return response || {};
      } catch (injectErr) {
        console.error("注入 Content Script 失败:", injectErr);
        return { error: injectErr.message };
      }
    }
    console.error("发送消息失败:", err);
    return { error: err.message };
  }
}

// 文件名清理
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

// 下载为文件
async function downloadAsFile(html, filename) {
  // Service Worker 中没有 URL.createObjectURL，使用 data URL
  const base64 = btoa(unescape(encodeURIComponent(html)));
  const dataUrl = `data:text/html;charset=utf-8;base64,${base64}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false,
  });
}

// 上传到服务器
async function uploadToServer(html, title, filename) {
  const { serverUrl, serverToken } = await chrome.storage.sync.get([
    "serverUrl",
    "serverToken",
  ]);

  if (!serverUrl) {
    console.error("未配置服务器地址");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (serverToken) {
    headers["Authorization"] = `Bearer ${serverToken}`;
  }

  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filename,
        title,
        html,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    console.log("上传成功");
  } catch (err) {
    console.error("上传失败:", err);
  }
}
