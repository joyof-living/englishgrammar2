// content.js — 텍스트 선택 감지 및 분석 버튼 표시

const MAX_WORDS = 300;
let popup = null;

function removePopup() {
  if (popup) { popup.remove(); popup = null; }
}

// 공통 버튼 스타일 (호스트 페이지 CSS 영향 차단을 위해 !important 사용)
// 컬러는 v2 브랜드 토큰 (tokens.css --brand / --brand-2) 과 매칭
const BRAND       = 'oklch(0.58 0.19 270)';
const BRAND_HOVER = 'oklch(0.68 0.18 270)';
const BRAND_SHADOW = 'oklch(0.22 0.04 260 / 0.25)';

const BTN_BASE = [
  `background:${BRAND}`,
  `color:#fff`,
  `border:none`,
  `border-radius:8px`,
  `font-weight:700`,
  `cursor:pointer`,
  `box-shadow:0 4px 12px ${BRAND_SHADOW}`,
  `font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif`,
  `letter-spacing:-0.01em`,
  `pointer-events:auto`,
  `opacity:1`,
  `visibility:visible`,
  `line-height:1.2`,
  `transition:background 120ms ease,transform 120ms ease`,
];

function makeButton(label, extraStyles, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.setAttribute('style', BTN_BASE.concat(extraStyles).map(s => s + ' !important').join(';'));
  btn.addEventListener('mouseenter', () => {
    btn.style.setProperty('background', BRAND_HOVER, 'important');
    btn.style.setProperty('transform', 'translateY(-1px)', 'important');
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.setProperty('background', BRAND, 'important');
    btn.style.setProperty('transform', 'translateY(0)', 'important');
  });
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
    // 선택 영역 해제 → 이어지는 mouseup이 새 팝업을 다시 만들지 않게
    try { window.getSelection()?.removeAllRanges(); } catch {}
    removePopup();
  });
  return btn;
}

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  removePopup();
  if (!text || text.split(/\s+/).length > MAX_WORDS) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const POPUP_HEIGHT = 32;
  const POPUP_MARGIN = 6;
  const top = (rect.bottom + POPUP_MARGIN + POPUP_HEIGHT > window.innerHeight)
    ? rect.top - POPUP_MARGIN - POPUP_HEIGHT
    : rect.bottom + POPUP_MARGIN;
  const left = Math.min(Math.max(4, rect.left), window.innerWidth - 160);

  // 컨테이너 (분석 + 설정 버튼)
  popup = document.createElement('div');
  popup.setAttribute('style', [
    `position:fixed`,
    `top:${top}px`,
    `left:${left}px`,
    `z-index:2147483647`,
    `display:inline-flex`,
    `gap:4px`,
    `pointer-events:auto`,
    `opacity:1`,
    `visibility:visible`,
  ].map(s => s + ' !important').join(';'));

  // 분석 버튼
  const analyzeBtn = makeButton('📖 문법 분석', [
    `padding:5px 12px`,
    `font-size:13px`,
  ], () => {
    chrome.runtime.sendMessage({ type: 'analyze', text });
  });

  // 설정 버튼 (톱니바퀴)
  const settingsBtn = makeButton('⚙', [
    `padding:5px 9px`,
    `font-size:14px`,
  ], () => {
    chrome.runtime.sendMessage({ type: 'openOptions' });
  });
  settingsBtn.title = '설정';

  popup.appendChild(analyzeBtn);
  popup.appendChild(settingsBtn);
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
