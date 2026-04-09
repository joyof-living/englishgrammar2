// options.js — API 키 저장/불러오기

const input  = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const status  = document.getElementById('status');

// 저장된 키 불러오기
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (apiKey) input.value = apiKey;
});

function showStatus(msg, ok) {
  status.textContent = msg;
  status.className = ok ? 'ok' : 'err';
  status.style.display = '';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
}

saveBtn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) return showStatus('API 키를 입력해주세요.', false);
  if (!key.startsWith('AIza')) return showStatus('유효한 Gemini API 키가 아닙니다 (AIza...로 시작해야 합니다).', false);
  chrome.storage.local.set({ apiKey: key }, () => {
    showStatus('저장되었습니다.', true);
  });
});
