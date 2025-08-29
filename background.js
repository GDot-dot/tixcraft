let monitoringTimeoutId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'start') {
    startMonitoring(request.data.minInterval, request.data.maxInterval);
  } else if (request.command === 'stop') {
    stopMonitoring();
  } else if (request.command === 'debug_extract') {
    runDebugExtraction();
  }
});

function startMonitoring(minInterval, maxInterval) {
  stopMonitoring(); 
  console.log(`監控已啟動。刷新間隔: ${minInterval} 到 ${maxInterval} 秒之間。`);
  checkPageAndThenScheduleNext(minInterval, maxInterval);
}

function stopMonitoring() {
  if (monitoringTimeoutId) {
    clearTimeout(monitoringTimeoutId);
    monitoringTimeoutId = null;
    console.log('監控已停止。');
  }
}

function checkPageAndThenScheduleNext(minInterval, maxInterval) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      console.log("找不到活動分頁，停止監控。");
      stopMonitoring();
      return;
    }
    const tabId = tabs[0].id;
    
    chrome.storage.local.get('keywords', (result) => {
      const rawKeywordsString = result.keywords || '';
      const keywordGroupsForOr = rawKeywordsString.split(',').map(k => k.trim()).filter(Boolean);
      
      if (keywordGroupsForOr.length === 0) return;

      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: extractAndSearchVisibleText,
        args: [keywordGroupsForOr]
      }, (injectionResults) => {
        if (chrome.runtime.lastError) {
            console.warn(`腳本注入失敗: ${chrome.runtime.lastError.message}。將在隨機延遲後重試...`);
            scheduleNextRefresh(tabId, minInterval, maxInterval);
            return;
        }
        const foundText = injectionResults[0]?.result;
        if (foundText) {
          console.log(`🎉 找到了！符合條件的文字: "${foundText}"`);
          notifyUser(foundText, tabs[0].url);
          stopMonitoring();
        } else {
          console.log("未找到關鍵字，準備下一次隨機刷新...");
          scheduleNextRefresh(tabId, minInterval, maxInterval);
        }
      });
    });
  });
}

function scheduleNextRefresh(tabId, min, max) {
  const randomDelay = (Math.random() * (max - min) + min) * 1000;
  console.log(`下一次刷新將在 ${(randomDelay / 1000).toFixed(2)} 秒後進行。`);

  monitoringTimeoutId = setTimeout(() => {
    console.log("時間到，正在刷新頁面...");
    chrome.tabs.reload(tabId, { bypassCache: true }, () => {
      if (chrome.runtime.lastError) {
        console.error("刷新頁面失敗:", chrome.runtime.lastError.message);
        checkPageAndThenScheduleNext(min, max);
        return;
      }
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          console.log("頁面載入完成，開始檢查文字...");
          checkPageAndThenScheduleNext(min, max);
        }
      });
    });
  }, randomDelay);
}

function extractAndSearchVisibleText(keywordGroupsForOr, isDebug = false) {
    const parsedKeywordGroups = keywordGroupsForOr.map(group => 
        group.split('&').map(k => k.trim()).filter(Boolean)
    );

    const allTexts = [];

    const isElementVisible = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const traverse = (node) => {
        if (node.nodeType === Node.ELEMENT_NODE && !isElementVisible(node)) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) allTexts.push(text);
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            for (const child of node.childNodes) traverse(child);
            if (node.shadowRoot) {
                for (const child of node.shadowRoot.childNodes) traverse(child);
            }
        }
    };

    const isKeywordMatch = (textBlock, keyword) => {
        const rangeMatch = keyword.match(/^([a-zA-Z]*)(\d+)~([a-zA-Z]*)(\d+)$/);
        if (rangeMatch) {
            const prefix1 = rangeMatch[1] || '';
            const startNum = parseInt(rangeMatch[2], 10);
            const prefix2 = rangeMatch[3] || prefix1;
            const endNum = parseInt(rangeMatch[4], 10);
            const regex = new RegExp(`(${prefix1}|${prefix2})(\\d+)`, 'g');
            let match;
            while ((match = regex.exec(textBlock)) !== null) {
                const numInText = parseInt(match[2], 10);
                if (numInText >= startNum && numInText <= endNum) {
                    return true;
                }
            }
            return false;
        } else {
            return textBlock.includes(keyword);
        }
    };

    traverse(document.body);
    if (isDebug) return allTexts.join(' ||| ');

    for (const textBlock of allTexts) {
        for (const andGroup of parsedKeywordGroups) {
            const allKeywordsInGroupFound = andGroup.every(keyword => isKeywordMatch(textBlock, keyword));
            if (allKeywordsInGroupFound) {
                return textBlock;
            }
        }
    }
    return null;
}

function runDebugExtraction() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: extractAndSearchVisibleText,
            args: [[], true]
        }, (injectionResults) => {
            if (chrome.runtime.lastError) { console.error("腳本注入失敗:", chrome.runtime.lastError.message); return; }
            if (injectionResults && injectionResults[0]) {
                console.log("--- ✅ 擴充功能看到的全部可見文字 ---");
                console.log(injectionResults[0].result);
                console.log("--- ⬆️ 文字結束 ⬆️ ---");
            } else { console.error("抓取文字失敗，沒有收到任何結果。"); }
        });
    });
}

function notifyUser(foundText, url) {
    chrome.notifications.create({
        type: 'basic', iconUrl: 'images/icon128.png',
        title: '找到目標了！',
        message: `在頁面上找到了文字: "${foundText}"`,
        priority: 2
    });
    chrome.notifications.onClicked.addListener((notificationId) => {
        chrome.tabs.query({ url: url }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, { active: true });
                chrome.windows.update(tabs[0].windowId, { focused: true });
            }
        });
    });
}