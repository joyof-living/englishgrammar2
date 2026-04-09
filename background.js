// background.js — 서비스 워커: 메시지 중계 및 API 호출

import { analyzeText, drilldownText } from './gemini.js';

let panelPort = null;

// 사이드패널 연결
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'drilldown') handleDrilldown(msg);
  });
});

// 콘텐츠 스크립트에서 분석 요청
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'analyze') handleAnalyze(msg.text);
});

async function handleAnalyze(text) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    try { await chrome.sidePanel.open({ tabId: tabs[0].id }); } catch {}
  }

  // 패널이 연결되기를 기다림
  await waitForPanel(1500);
  sendToPanel({ type: 'loading' });

  try {
    const result = await analyzeText(text);
    sendToPanel({ type: 'result', data: result });
  } catch (e) {
    sendToPanel({ type: 'error', message: e.message, errorType: e.errorType || 'api_error' });
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
    try { panelPort.postMessage(msg); } catch {}
  }
}

function waitForPanel(ms) {
  return new Promise(resolve => {
    if (panelPort) return resolve();
    const start = Date.now();
    const check = setInterval(() => {
      if (panelPort || Date.now() - start > ms) { clearInterval(check); resolve(); }
    }, 100);
  });
}
