// welcome.js — 온보딩 페이지: API 키 저장 및 성공 상태 전환

const input      = document.getElementById('api-key');
const modelSel   = document.getElementById('model');
const saveBtn    = document.getElementById('save-btn');
const status     = document.getElementById('status');
const setupSec   = document.getElementById('setup-section');
const pasteSec   = document.getElementById('paste-section');
const successSec = document.getElementById('success-section');

const GOOGLE_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'];
const GROQ_MODELS   = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'];
const MODEL_LABELS = {
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-2.5-flash':      'Gemini 2.5 Flash',
  'gemini-2.5-pro':        'Gemini 2.5 Pro',
  'llama-3.3-70b-versatile': 'Llama 3.3 70B',
  'llama-3.1-8b-instant':    'Llama 3.1 8B',
  'mixtral-8x7b-32768':      'Mixtral 8x7B',
  'gemma2-9b-it':            'Gemma 2 9B',
};

function detectProvider(key) {
  if (key.startsWith('AIza')) return 'google';
  if (key.startsWith('gsk_')) return 'groq';
  return 'vertex';
}
function resolveActualModel(provider, selectedModel) {
  if (provider === 'groq') {
    return GROQ_MODELS.includes(selectedModel) ? selectedModel : 'llama-3.3-70b-versatile';
  }
  return GOOGLE_MODELS.includes(selectedModel) ? selectedModel : 'gemini-2.5-flash-lite';
}
function providerLabel(provider) {
  if (provider === 'google') return 'Gemini';
  if (provider === 'groq')   return 'Groq';
  return 'Vertex AI';
}

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

    // 성공 화면에 실제 실행 프로바이더/모델 표시
    const provider = detectProvider(key);
    const actualModel = resolveActualModel(provider, modelSel.value);
    const mismatch = provider === 'groq' && actualModel !== modelSel.value;
    const runInfo = document.getElementById('run-info');
    if (runInfo) {
      let text = `${providerLabel(provider)} 키 → ${MODEL_LABELS[actualModel] || actualModel}로 실행됩니다.`;
      if (mismatch) text += ' (선택한 Gemini 모델 대신 Groq 기본 모델 자동 적용)';
      runInfo.textContent = text;
    }

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
