document.addEventListener('DOMContentLoaded', () => {
  const keywordAInput = document.getElementById('keyword-a');
  const keywordBInput = document.getElementById('keyword-b');
  const keywordCInput = document.getElementById('keyword-c');
  const minIntervalInput = document.getElementById('min-interval');
  const maxIntervalInput = document.getElementById('max-interval');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const debugBtn = document.getElementById('debug-btn');

  chrome.storage.local.get(['keywords', 'minInterval', 'maxInterval'], (result) => {
    if (result.keywords) {
      keywordAInput.value = result.keywords.a || '';
      keywordBInput.value = result.keywords.b || '';
      keywordCInput.value = result.keywords.c || '';
    }
    if (result.minInterval) minIntervalInput.value = result.minInterval;
    if (result.maxInterval) maxIntervalInput.value = result.maxInterval;
  });

  startBtn.addEventListener('click', () => {
    const keywords = {
      a: keywordAInput.value.trim(),
      b: keywordBInput.value.trim(),
      c: keywordCInput.value.trim()
    };
    const minInterval = parseFloat(minIntervalInput.value);
    const maxInterval = parseFloat(maxIntervalInput.value);

    if (!keywords.a && !keywords.c) {
      alert('請至少輸入「主要關鍵字 (A)」或「次要關鍵字 (C)」！');
      return;
    }
    if ((keywords.b && !keywords.a)) {
        alert('輸入「範圍結束 (B)」時，必須同時輸入「主要關鍵字 (A)」。');
        return;
    }
    if (!minInterval || !maxInterval || minInterval >= maxInterval) {
      alert('請設定有效的刷新時間範圍！');
      return;
    }

    chrome.storage.local.set({ keywords, minInterval, maxInterval });

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