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
      const keywords = result.keywords || { a: '', b: '', c: '' };
      
      if (!keywords.a && !keywords.c) {
          console.log("未設定有效關鍵字，等待下一次刷新...");
          scheduleNextRefresh(tabId, minInterval, maxInterval);
          return;
      }

      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: extractAndSearchVisibleText,
        args: [keywords]
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

function extractAndSearchVisibleText(keywords, isDebug = false) {
    const { a, b, c } = keywords;

    // --- 步驟一：生成目標字串清單 (邏輯不變) ---
    const targetStrings = [];
    const parseKeyword = (kw) => {
        const match = kw.match(/^([a-zA-Z\s]*)(\d+)$/);
        if (match) return { prefix: match[1] || '', num: parseInt(match[2], 10) };
        return null;
    };
    const parsedA = parseKeyword(a);
    const parsedB = parseKeyword(b);
    if (a && b && parsedA && parsedB && parsedA.prefix === parsedB.prefix) {
        const prefix = parsedA.prefix;
        for (let i = parsedA.num; i <= parsedB.num; i++) {
            targetStrings.push(`${prefix}${i}${c}`);
        }
    } else if (a) {
        targetStrings.push(`${a}${c}`);
    } else if (c) {
        targetStrings.push(c);
    }
    
    // --- 步驟二：全新的「深度優先」遍歷與即時搜尋邏輯 ---
    const traverseAndSearch = (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            // 1. 優先深入子節點和 Shadow DOM 進行搜尋
            for (const child of node.childNodes) {
                const result = traverseAndSearch(child);
                if (result) return result; // 如果子節點已找到，立刻返回，不再檢查當前節點
            }
            if (node.shadowRoot) {
                for (const child of node.shadowRoot.childNodes) {
                    const result = traverseAndSearch(child);
                    if (result) return result;
                }
            }

            // 2. 如果所有子節點都沒找到，再檢查當前節點本身
            const style = window.getComputedStyle(node);
            if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1) {
                // 使用 textContent 來獲取最純粹的文字，避免子元素的可見性干擾
                const nodeText = node.textContent;
                if (nodeText && nodeText.trim()) {
                    // 將文字清理乾淨，方便比對
                    const cleanTextBlock = nodeText.trim().replace(/\s+/g, ' ');
                    for (const target of targetStrings) {
                        if (cleanTextBlock.includes(target)) {
                            // 找到了！返回這個節點的文字，這是我們能找到的最小範圍
                            return cleanTextBlock; 
                        }
                    }
                }
            }
        }
        return null; // 在此路徑上未找到
    };

    // --- 除錯模式 ---
    if (isDebug) {
        // ... 除錯模式邏輯保持不變，但我們可以讓它更清晰 ...
        const allTextBlocks = new Set();
        const collectAll = (node) => {
             if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                    // 只收集沒有子元素的節點的文字，或者葉子節點的父節點
                    if (node.children.length === 0 && node.textContent.trim()) {
                        allTextBlocks.add(node.textContent.trim().replace(/\s+/g, ' '));
                    }
                    for (const child of node.childNodes) collectAll(child);
                    if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) collectAll(child);
                }
            }
        };
        collectAll(document.body);
        console.log("--- 🔎 將要尋找的目標清單 ---");
        console.log(targetStrings);
        console.log("--- ✅ 擴充功能看到的『最小單位』可見文字 ---");
        return Array.from(allTextBlocks).join(' ||| ');
    }

    // --- 步驟三：啟動搜尋 ---
    return traverseAndSearch(document.body);
}

function runDebugExtraction() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: extractAndSearchVisibleText,
            args: [{ a: '', b: '', c: '' }, true] // 傳入空物件和 debug 標記
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