document.addEventListener('DOMContentLoaded', () => {
  const keywordsInput = document.getElementById('keywords');
  const minIntervalInput = document.getElementById('min-interval');
  const maxIntervalInput = document.getElementById('max-interval');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const debugBtn = document.getElementById('debug-btn');

  // 載入已儲存的設定
  chrome.storage.local.get(['keywords', 'minInterval', 'maxInterval'], (result) => {
    if (result.keywords) keywordsInput.value = result.keywords;
    if (result.minInterval) minIntervalInput.value = result.minInterval;
    if (result.maxInterval) maxIntervalInput.value = result.maxInterval;
  });

  startBtn.addEventListener('click', () => {
    const keywords = keywordsInput.value;
    const minInterval = parseFloat(minIntervalInput.value);
    const maxInterval = parseFloat(maxIntervalInput.value);

    // 驗證輸入
    if (!keywords || !minInterval || !maxInterval) {
      alert('請輸入有效的關鍵字和時間範圍！');
      return;
    }
    if (minInterval >= maxInterval) {
      alert('最小秒數必須小於最大秒數！');
      return;
    }
    if (minInterval < 1) {
      alert('最小秒數建議大於或等於 1 秒，以避免被網站封鎖。');
      return;
    }

    // 儲存設定
    chrome.storage.local.set({ keywords, minInterval, maxInterval });

    // 傳送訊息給 background.js 開始監控
    chrome.runtime.sendMessage({
      command: 'start',
      data: { minInterval, maxInterval }
    });
    window.close();
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'stop' });
    window.close();
  });

  debugBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'debug_extract' });
    alert("已送出抓取指令，請打開擴充功能的『服務工作處理程序』(Service Worker) 查看結果！");
  });
});