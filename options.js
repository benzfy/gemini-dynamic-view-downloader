// 国际化处理
function applyI18n() {
  // 翻译文本内容
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.textContent = message;
    }
  });
  
  // 翻译 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.placeholder = message;
    }
  });
  
  // 更新页面标题
  const titleKey = document.querySelector('title')?.getAttribute('data-i18n');
  if (titleKey) {
    const message = chrome.i18n.getMessage(titleKey);
    if (message) {
      document.title = message;
    }
  }
}

// 加载已保存的设置
document.addEventListener('DOMContentLoaded', async () => {
  // 应用国际化
  applyI18n();
  
  const result = await chrome.storage.sync.get([
    'sihubUrl',
    'sihubApiKey'
  ]);
  
  if (result.sihubUrl) {
    document.getElementById('sihubUrl').value = result.sihubUrl;
  }
  if (result.sihubApiKey) {
    document.getElementById('sihubApiKey').value = result.sihubApiKey;
  }
});

// 保存设置
document.getElementById('save').addEventListener('click', async () => {
  const sihubUrl = document.getElementById('sihubUrl').value.trim();
  const sihubApiKey = document.getElementById('sihubApiKey').value.trim();
  const status = document.getElementById('status');
  
  try {
    await chrome.storage.sync.set({ 
      sihubUrl,
      sihubApiKey
    });
    
    // 通知 background 更新菜单
    chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    
    status.textContent = chrome.i18n.getMessage('optionsSaved');
    status.className = 'status success';
    
    setTimeout(() => {
      status.className = 'status';
    }, 2000);
  } catch (error) {
    status.textContent = chrome.i18n.getMessage('optionsSaveFailed') + error.message;
    status.className = 'status error';
  }
});
