// 加载已保存的设置
document.addEventListener('DOMContentLoaded', async () => {
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

