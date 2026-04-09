// options.js — API 키 및 모델 저장/불러오기

const input    = document.getElementById('api-key');
const modelSel = document.getElementById('model');
const saveBtn  = document.getElementById('save-btn');
const status   = document.getElementById('status');

// 저장된 설정 불러오기
chrome.storage.local.get(['apiKey', 'model'], (result) => {
  if (result.apiKey) input.value = result.apiKey;
  if (result.model) modelSel.value = result.model;
});

function showStatus(msg, ok) {
  status.textContent = msg;
  status.className = ok ? 'ok' : 'err';
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
}

saveBtn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) return showStatus('API 키를 입력해주세요.', false);
  try {
    await chrome.storage.local.set({ apiKey: key, model: modelSel.value });
    showStatus('저장되었습니다.', true);
  } catch (e) {
    showStatus('저장 실패: ' + e.message, false);
  }
});
