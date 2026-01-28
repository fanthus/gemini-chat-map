// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');

  // 默认勾选（内容脚本默认开启）
  toggle.checked = true;

  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;

      chrome.tabs.sendMessage(tab.id, {
        type: 'GEMINI_CHAT_MAP_TOGGLE',
        enabled
      });
    });
  });
});

