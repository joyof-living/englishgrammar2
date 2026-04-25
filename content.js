// content.js — 텍스트 선택 감지 및 분석 버튼 표시

const MAX_WORDS = 300;
let popup = null;

function removePopup() {
  if (popup) { popup.remove(); popup = null; }
}

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  removePopup();
  if (!text || text.split(/\s+/).length > MAX_WORDS) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  popup = document.createElement('button');
  popup.textContent = '📖 문법 분석';

  const POPUP_HEIGHT = 32;
  const POPUP_MARGIN = 6;
  const top = (rect.bottom + POPUP_MARGIN + POPUP_HEIGHT > window.innerHeight)
    ? rect.top - POPUP_MARGIN - POPUP_HEIGHT
    : rect.bottom + POPUP_MARGIN;
  const left = Math.min(Math.max(4, rect.left), window.innerWidth - 120);

  popup.setAttribute('style', [
    `position:fixed`,
    `top:${top}px`,
    `left:${left}px`,
    `z-index:2147483647`,
    `background:#2563eb`,
    `color:#fff`,
    `border:none`,
    `border-radius:6px`,
    `padding:5px 12px`,
    `font-size:13px`,
    `font-weight:600`,
    `cursor:pointer`,
    `box-shadow:0 2px 10px rgba(0,0,0,0.25)`,
    `font-family:system-ui,-apple-system,sans-serif`,
    `letter-spacing:0.01em`,
    `pointer-events:auto`,
    `opacity:1`,
    `visibility:visible`,
    `display:inline-block`,
  ].map(s => s + ' !important').join(';'));

  popup.addEventListener('mouseenter', () => { popup.style.setProperty('background', '#1d4ed8', 'important'); });
  popup.addEventListener('mouseleave', () => { popup.style.setProperty('background', '#2563eb', 'important'); });

  // mousedown으로 처리 — click보다 먼저 발생하므로 mouseup과 충돌 없음
  popup.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'analyze', text });
    removePopup();
  });

  document.body.appendChild(popup);
});

document.addEventListener('mousedown', (e) => {
  if (popup && !popup.contains(e.target)) removePopup();
});
document.addEventListener('scroll', removePopup, true);

// ─── 분석 결과를 main world로 전달 (postMessage 방식) ───
// CSP에 의존하지 않음. 페이지가 message 이벤트를 받아 window.__lastAnalysis 등에 저장.
//   window.addEventListener('message', e => {
//     if (e.source === window && e.data?.source === 'svocat' && e.data?.type === 'result') {
//       window.__lastAnalysis = e.data.data;
//       window.dispatchEvent(new CustomEvent('svocat:result', { detail: e.data.data }));
//     }
//   });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'svocat:result') return;
  window.postMessage({ source: 'svocat', type: 'result', data: msg.data }, '*');
});
