// background.js — 서비스 워커: 메시지 중계 및 API 호출

import { analyzeText, drilldownText } from './gemini.js';

let panelPort = null;
let pendingAnalysis = null;
let currentController = null;

// 사이드패널 연결
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'drilldown') handleDrilldown(msg);
  });

  // 패널이 열리길 기다리던 분석 요청이 있으면 실행
  if (pendingAnalysis) {
    const text = pendingAnalysis;
    pendingAnalysis = null;
    handleAnalyze(text);
  }
});

// 확장프로그램 아이콘 클릭 시 사이드패널 열기
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 콘텐츠 스크립트에서 분석 요청
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'analyze') {
    if (panelPort) {
      handleAnalyze(message.text);
    } else {
      pendingAnalysis = message.text;
      if (sender.tab?.id) {
        chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {
          pendingAnalysis = null;
          handleAnalyze(message.text);
        });
      }
    }
  }
  return false;
});

async function handleAnalyze(text) {
  // 이전 요청 취소
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const signal = currentController.signal;

  sendToPanel({ type: 'loading' });

  try {
    const result = await analyzeText(text, signal);
    sendToPanel({ type: 'result', data: result });
  } catch (e) {
    if (e.name === 'AbortError') return;
    sendToPanel({ type: 'error', message: e.message, errorType: e.errorType || 'api_error' });
  } finally {
    currentController = null;
  }
}

async function handleDrilldown({ text, parentRole, requestId }) {
  try {
    const result = await drilldownText(text, parentRole);
    sendToPanel({ type: 'drilldown_result', data: result, requestId });
  } catch (e) {
    sendToPanel({ type: 'drilldown_error', message: e.message, requestId });
  }
}

function sendToPanel(msg) {
  if (panelPort) {
    try { panelPort.postMessage(msg); } catch (e) {
      console.error('[ET Grammar] Failed to send to panel:', e);
    }
  }
}
