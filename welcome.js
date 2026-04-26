// welcome.js — 온보딩 페이지: API 키 저장 및 성공 상태 전환

const input      = document.getElementById('api-key');
const modelSel   = document.getElementById('model');
const saveBtn    = document.getElementById('save-btn');
const status     = document.getElementById('status');
const setupSec   = document.getElementById('setup-section');
const pasteSec   = document.getElementById('paste-section');
const successSec = document.getElementById('success-section');

// 기존 설정 불러오기 (재방문 시)
chrome.storage.local.get(['apiKey', 'model'], (result) => {
  if (result.apiKey) input.value = result.apiKey;
  if (result.model) modelSel.value = result.model;
});

function showStatus(msg, ok) {
  status.textContent = msg;
  status.className = ok ? 'ok' : 'err';
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 4000);
}

async function save() {
  const key = input.value.trim();
  if (!key) return showStatus('API 키를 입력해주세요.', false);
  if (key.length < 10) return showStatus('API 키가 너무 짧습니다.', false);
  try {
    await chrome.storage.local.set({ apiKey: key, model: modelSel.value });

    setupSec.style.display = 'none';
    pasteSec.style.display = 'none';
    successSec.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    showStatus('저장 실패: ' + e.message, false);
  }
}

saveBtn.addEventListener('click', save);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});
