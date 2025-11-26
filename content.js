// 监听来自 background 的消息（备用方案）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getFrameContent") {
    sendResponse({
      html: document.documentElement.outerHTML,
      title: document.title,
      url: location.href
    });
  }
  return true;
});

