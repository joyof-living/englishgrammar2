// background.js — 서비스 워커: 메시지 중계 및 API 호출

import { analyzeText, drilldownText } from './gemini.js';

const DEBUG = false;
const log = DEBUG ? console.warn.bind(console, '[SVOCAt]') : () => {};

let panelPort = null;
let pendingAnalysis = null;
let currentController = null;
let popupWindowId = null;
let popupTabId = null;
let analysisSourceTabId = null; // 마지막 분석 요청을 보낸 탭 (결과를 window.__lastAnalysis로 노출하기 위함)
let currentDisplayMode = 'sidepanel'; // 'sidepanel' | 'popup' | 'tab'

// ─── 표시 모드 캐시 (user gesture 유지를 위해 storage를 미리 메모리에) ───
chrome.storage.local.get('displayMode', ({ displayMode }) => {
  if (displayMode) currentDisplayMode = displayMode;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.displayMode) {
    currentDisplayMode = changes.displayMode.newValue || 'sidepanel';
  }
});

// ─── 액션 아이콘 클릭: 모드에 따라 분기 ───
// setPanelBehavior는 action.onClicked와 충돌하므로 제거 — 수동 처리
chrome.action.onClicked.addListener((tab) => {
  openUI(tab);
});

function openUI(sourceTab) {
  if (currentDisplayMode === 'popup') {
    openOrFocusPopup();
  } else if (currentDisplayMode === 'tab') {
    openOrFocusTab(sourceTab);
  } else if (sourceTab?.id) {
    chrome.sidePanel.open({ tabId: sourceTab.id }).catch(e => log('사이드패널 열기 실패:', e.message));
  }
}

async function openOrFocusPopup() {
  if (popupWindowId !== null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch {
      popupWindowId = null;
    }
  }
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('sidepanel.html'),
      type: 'popup',
      width: 440,
      height: 760,
    });
    popupWindowId = win.id;
  } catch (e) {
    log('팝업 창 열기 실패:', e.message);
  }
}

async function openOrFocusTab(sourceTab) {
  if (popupTabId !== null) {
    try {
      await chrome.tabs.update(popupTabId, { active: true });
      // 이미 떠있는 분석 탭을 source 그룹에 다시 합치기 (재배치)
      if (sourceTab) await groupAnalysisTab(popupTabId, sourceTab);
      return;
    } catch {
      popupTabId = null;
    }
  }

  const createOptions = { url: chrome.runtime.getURL('sidepanel.html'), active: true };
  if (sourceTab) {
    createOptions.index = sourceTab.index + 1;
    createOptions.windowId = sourceTab.windowId;
  }

  try {
    const newTab = await chrome.tabs.create(createOptions);
    popupTabId = newTab.id;
    if (sourceTab) await groupAnalysisTab(newTab.id, sourceTab);
  } catch (e) {
    log('탭 열기 실패:', e.message);
  }
}

// 분석 탭을 source 탭과 같은 그룹에 합치기
// (Claude for Chrome 등 탭 기반 확장이 분석 결과를 인식할 수 있도록)
async function groupAnalysisTab(analysisTabId, sourceTab) {
  if (!chrome.tabs.group) return;
  try {
    const inGroup = sourceTab.groupId !== undefined && sourceTab.groupId !== -1;
    if (inGroup) {
      // source가 이미 그룹에 있으면 분석 탭만 같은 그룹에 추가
      await chrome.tabs.group({ tabIds: [analysisTabId], groupId: sourceTab.groupId });
    } else {
      // 그룹 없으면 새 그룹 만들고 둘 다 추가
      const groupId = await chrome.tabs.group({ tabIds: [sourceTab.id, analysisTabId] });
      if (chrome.tabGroups) {
        try {
          await chrome.tabGroups.update(groupId, { title: '에스보냥 분석', color: 'blue' });
        } catch (e) { log('그룹 이름/색 설정 실패:', e.message); }
      }
    }
  } catch (e) {
    log('탭 그룹화 실패:', e.message);
  }
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === popupWindowId) popupWindowId = null;
});

chrome.tabs.onRemoved.addListener((id) => {
  if (id === popupTabId) popupTabId = null;
});

// ─── 최초 설치 시 환영 페이지 오픈 ───
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  }
});

// ─── 사이드패널/팝업 공통: port 연결 ───
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'drilldown') handleDrilldown(msg);
  });

  if (pendingAnalysis) {
    const text = pendingAnalysis;
    pendingAnalysis = null;
    handleAnalyze(text);
  }
});

// ─── 콘텐츠 스크립트에서 분석 요청 ───
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'analyze') {
    analysisSourceTabId = sender.tab?.id ?? null;
    if (panelPort) {
      handleAnalyze(message.text);
    } else {
      pendingAnalysis = message.text;
      openUI(sender.tab);
    }
  } else if (message.type === 'openOptions') {
    chrome.runtime.openOptionsPage().catch(e => log('옵션 페이지 열기 실패:', e.message));
  }
  return false;
});

async function handleAnalyze(text) {
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const signal = currentController.signal;
  const sourceTabId = analysisSourceTabId;

  sendToPanel({ type: 'loading' });

  try {
    const result = await analyzeText(text, signal);
    sendToPanel({ type: 'result', data: result });
    // source 탭에도 결과 전달 → window.__lastAnalysis로 노출
    if (sourceTabId !== null) {
      try { chrome.tabs.sendMessage(sourceTabId, { type: 'svocat:result', data: result }); }
      catch (e) { log('결과 전달 실패:', e.message); }
    }
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
    try { panelPort.postMessage(msg); }
    catch (e) { log('패널 전송 실패:', e.message); }
  }
}
