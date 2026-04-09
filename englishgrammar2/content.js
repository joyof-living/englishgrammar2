// content.js — 텍스트 선택 감지 및 분석 버튼 표시

let popup = null;

function removePopup() {
  if (popup) { popup.remove(); popup = null; }
}

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  removePopup();
  if (!text || text.split(/\s+/).length > 300) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  popup = document.createElement('button');
  popup.textContent = '📖 문법 분석';
  Object.assign(popup.style, {
    position: 'fixed',
    top: `${rect.bottom + 6}px`,
    left: `${Math.max(4, rect.left)}px`,
    zIndex: '2147483647',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '5px 12px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    letterSpacing: '0.01em',
  });

  popup.addEventListener('mouseenter', () => { popup.style.background = '#1d4ed8'; });
  popup.addEventListener('mouseleave', () => { popup.style.background = '#2563eb'; });

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
