// 加载 JSZip 库（用于创建 zip 文件上传）
importScripts('jszip.min.js');

// 右键菜单 ID
const MENU_SAVE_LOCAL = "save-local";
const MENU_SAVE_AND_PUBLISH = "save-and-publish";

// 创建右键菜单 - 安装/更新时
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated, creating menus");
  createContextMenus();
});

// 浏览器启动时
chrome.runtime.onStartup.addListener(() => {
  console.log("Browser started, creating menus");
  createContextMenus();
});

// Service Worker 启动时也要创建菜单
console.log("Service Worker started, creating menus");
createContextMenus().catch((err) => console.error("Failed to create menus:", err));

// 监听设置更新
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "settingsUpdated") {
    createContextMenus();
  }
});

// 菜单创建锁，防止并发创建
let isCreatingMenus = false;

// 创建或更新右键菜单
async function createContextMenus() {
  if (isCreatingMenus) return;
  isCreatingMenus = true;
  
  try {
    await chrome.contextMenus.removeAll();

    // 仅下载到本地
    chrome.contextMenus.create({
      id: MENU_SAVE_LOCAL,
      title: chrome.i18n.getMessage("menuSaveLocal"),
      contexts: ["page", "frame"],
    });

    // 检查是否配置了 SIHub，如果配置了则显示"下载并发布"选项
    const { sihubUrl } = await chrome.storage.sync.get(["sihubUrl"]);
    if (sihubUrl) {
      chrome.contextMenus.create({
        id: MENU_SAVE_AND_PUBLISH,
        title: chrome.i18n.getMessage("menuSaveAndPublish"),
        contexts: ["page", "frame"],
      });
    }

    console.log("Context menus created");
  } catch (err) {
    console.error("Failed to create menus:", err);
  } finally {
    isCreatingMenus = false;
  }
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SAVE_LOCAL) {
    // 仅下载到本地
    await savePageAsHtml(info, tab, { downloadLocal: true, publishToCloud: false });
  } else if (info.menuItemId === MENU_SAVE_AND_PUBLISH) {
    // 下载到本地 + 发布到云端
    await savePageAsHtml(info, tab, { downloadLocal: true, publishToCloud: true });
  }
});

// 保存页面为 HTML
async function savePageAsHtml(info, tab, options = {}) {
  const { downloadLocal = true, publishToCloud = false } = options;
  
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

    // 下载到本地
    if (downloadLocal) {
      await downloadAsFile(html, filename);
      console.log("Saved to local:", filename);
    }

    // 发布到云端
    if (publishToCloud) {
      await uploadToSihub(html, title, filename, tab.id, targetFrameId);
    }

  } catch (err) {
    console.error("保存失败:", err);
  }
}

// 发送消息到指定 frame（先注入 Content Script）
async function sendMessageToFrame(tabId, frameId, message) {
  // 先尝试注入 content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, frameIds: [frameId] },
      files: ["content.js"],
    });
    console.log("Content script injected successfully");
  } catch (injectErr) {
    // 可能已经注入过，或者页面不支持
    console.log("Content script injection:", injectErr.message);
  }

  // 等待一小段时间确保脚本加载完成
  await new Promise(resolve => setTimeout(resolve, 100));

  // 发送消息
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, {
      frameId: frameId,
    });
    return response || {};
  } catch (err) {
    console.error("Send message failed:", err);
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

// 上传到云端（使用预签名 URL 方式）
async function uploadToSihub(html, title, filename, tabId, frameId) {
  const { sihubUrl, sihubApiKey } = await chrome.storage.sync.get([
    "sihubUrl",
    "sihubApiKey",
  ]);

  if (!sihubUrl) {
    console.error("Endpoint URL not configured");
    await showNotification(tabId, frameId, "error", chrome.i18n.getMessage("toastNoEndpoint"));
    return;
  }

  if (!sihubApiKey) {
    console.error("API Key not configured");
    await showNotification(tabId, frameId, "error", chrome.i18n.getMessage("toastNoApiKey"));
    return;
  }

  try {
    // 通知开始上传
    await showUploadProgress(tabId, frameId, "uploading", "Creating ZIP file...");

    // 创建 zip 文件
    const zip = new JSZip();
    zip.file("index.html", html);
    
    // 生成 zip blob
    const zipBlob = await zip.generateAsync({ 
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    
    const zipFilename = sanitizeFilename(title || "page") + ".zip";
    const baseUrl = sihubUrl.replace(/\/+$/, ''); // 移除末尾斜杠
    const zipSizeMB = (zipBlob.size / 1024 / 1024).toFixed(2);

    // Step 1: 获取预签名上传 URL
    await showUploadProgress(tabId, frameId, "uploading", "Getting upload URL...");
    const uploadUrlEndpoint = `${baseUrl}/upload-url`;
    console.log("Step 1: Getting presigned upload URL from:", uploadUrlEndpoint);
    
    const uploadUrlResponse = await fetch(uploadUrlEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sihubApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename: zipFilename }),
    });

    const responseText = await uploadUrlResponse.text();
    console.log("Response status:", uploadUrlResponse.status);
    console.log("Response body:", responseText.substring(0, 200));

    if (!uploadUrlResponse.ok) {
      // 检查是否是 HTML 错误页面
      if (responseText.startsWith('<!') || responseText.startsWith('<html')) {
        throw new Error(`API returned HTML (status ${uploadUrlResponse.status}). URL: ${uploadUrlEndpoint}`);
      }
      throw new Error(`Failed to get upload URL: ${uploadUrlResponse.status} - ${responseText}`);
    }

    // 检查响应是否是 JSON
    if (responseText.startsWith('<!') || responseText.startsWith('<html')) {
      throw new Error(`API returned HTML instead of JSON. Check your API URL: ${uploadUrlEndpoint}`);
    }

    let uploadUrlData;
    try {
      uploadUrlData = JSON.parse(responseText);
    } catch (e) {
      if (responseText.includes('<!doctype') || responseText.includes('<html')) {
        throw new Error(`API URL 可能配置错误，服务器返回了 HTML 页面而不是 JSON。请检查 URL: ${uploadUrlEndpoint}`);
      }
      throw new Error(`无效的 JSON 响应: ${responseText.substring(0, 100)}...`);
    }
    const { upload_id, presigned_url } = uploadUrlData;
    
    if (!upload_id || !presigned_url) {
      throw new Error(`Invalid response from server: ${JSON.stringify(uploadUrlData)}`);
    }
    console.log("Got upload_id:", upload_id);

    // Step 2: 直接上传 ZIP 文件到对象存储
    await showUploadProgress(tabId, frameId, "uploading", `Uploading ${zipSizeMB} MB...`);
    console.log("Step 2: Uploading ZIP to object storage...");
    
    const uploadResponse = await fetch(presigned_url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/zip",
      },
      body: zipBlob,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text().catch(() => '');
      throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`);
    }
    console.log("File uploaded successfully");

    // Step 3: 创建项目
    await showUploadProgress(tabId, frameId, "uploading", "Creating project...");
    console.log("Step 3: Creating project...");
    
    const createProjectResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sihubApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        upload_id: upload_id,
        title: title || "Untitled",
        description: `Saved from Dynamic View on ${new Date().toLocaleString()}`,
      }),
    });

    if (!createProjectResponse.ok) {
      const errorText = await createProjectResponse.text();
      if (errorText.startsWith('<!') || errorText.startsWith('<html')) {
        throw new Error(`API returned HTML instead of JSON. Check your API URL.`);
      }
      throw new Error(`Failed to create project: ${createProjectResponse.status} - ${errorText}`);
    }

    const result = await createProjectResponse.json();
    console.log("Project created:", result);
    
    const projectId = result.id;
    
    // Step 4: 轮询查询项目状态
    await showUploadProgress(tabId, frameId, "processing", "Processing...");
    console.log("Step 4: Polling project status...");
    
    const maxAttempts = 40; // 最多等待 120 秒 (40 * 3s)
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // 每 3 秒查询一次
      attempts++;
      
      const statusResponse = await fetch(`${baseUrl}/${projectId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${sihubApiKey}`,
        },
      });
      
      if (!statusResponse.ok) {
        console.warn("Failed to get project status:", statusResponse.status);
        continue;
      }
      
      const projectData = await statusResponse.json();
      console.log(`Project status (${attempts}s):`, projectData.status);
      
      if (projectData.status === "ready") {
        // 处理完成 - 从 API URL 提取域名 + 固定路径 /project
        try {
          const apiUrlObj = new URL(baseUrl);
          const projectUrl = `${apiUrlObj.origin}/project/${projectId}`;
          await showUploadProgress(tabId, frameId, "success", "Published!", projectUrl);
          console.log("Project ready! URL:", projectUrl);
          return;
        } catch (err) {
          console.error("Failed to construct project URL:", err);
          await showUploadProgress(tabId, frameId, "success", "Published! (URL unavailable)");
          return;
        }
      } else if (projectData.status === "failed") {
        throw new Error(`Project processing failed: ${projectData.error_msg || 'Unknown error'}`);
      }
      
      // 更新进度显示（实际经过的秒数 = 查询次数 * 3）
      await showUploadProgress(tabId, frameId, "processing", `Processing... (${attempts * 3}s)`);
    }
    
    // 超时但没有失败，显示部分成功
    await showUploadProgress(tabId, frameId, "success", "Uploaded! Still processing...");

  } catch (err) {
    console.error("Upload failed:", err);
    await showUploadProgress(tabId, frameId, "error", err.message);
  }
}

// 显示上传进度（通过 content script）
async function showUploadProgress(tabId, frameId, status, message, url = '') {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "showUploadProgress",
      status,
      message,
      url,
    }, { frameId });
  } catch (err) {
    console.error("Failed to show upload progress:", err);
  }
}

// 显示通知（通过 content script）
async function showNotification(tabId, frameId, type, message) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "showNotification",
      type,
      message,
    }, { frameId });
  } catch (err) {
    console.error("显示通知失败:", err);
  }
}
