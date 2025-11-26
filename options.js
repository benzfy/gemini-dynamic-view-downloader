// 加载已保存的设置
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get(['serverUrl', 'serverToken']);
  if (result.serverUrl) {
    document.getElementById('serverUrl').value = result.serverUrl;
  }
  if (result.serverToken) {
    document.getElementById('serverToken').value = result.serverToken;
  }
});

// 保存设置
document.getElementById('save').addEventListener('click', async () => {
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const serverToken = document.getElementById('serverToken').value.trim();
  const status = document.getElementById('status');
  
  try {
    await chrome.storage.sync.set({ serverUrl, serverToken });
    
    // 通知 background 更新菜单
    chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    
    status.textContent = '✓ 设置已保存';
    status.className = 'status success';
    
    setTimeout(() => {
      status.className = 'status';
    }, 2000);
  } catch (error) {
    status.textContent = '✗ 保存失败: ' + error.message;
    status.className = 'status error';
  }
});

