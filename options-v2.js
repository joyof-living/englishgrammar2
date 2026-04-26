// options-v2.js — 설정 페이지 v2 와이어업
// v1 options.js 의 비즈니스 로직 이식 + v2 인터랙션 (테이블 활성행, 모드 카드)

(() => {
  // ─── DOM ───
  const input        = document.getElementById('api-key');
  const inputStatus  = document.getElementById('api-key-status');
  const modelSel     = document.getElementById('model');
  const modelTable   = document.getElementById('model-table');
  const modeGroup    = document.getElementById('mode-group');
  const saveBtn      = document.getElementById('save-btn');
  const deleteBtn    = document.getElementById('delete-btn');
  const statusEl     = document.getElementById('status');
  const warnBanner   = document.getElementById('warn-banner');
  const warnClose    = document.getElementById('warn-close');

  // ─── 헤더 마스코트 ───
  const headerMascot = document.getElementById('header-mascot');
  if (headerMascot && window.createMascot) {
    headerMascot.appendChild(window.createMascot({ size: 36, expression: 'happy' }));
  }

  // ─── 프로바이더/모델 매핑 (gemini.js 와 일치) ───
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
  function buildSaveMessage(key, selectedModel) {
    const provider = detectProvider(key);
    const actualModel = resolveActualModel(provider, selectedModel);
    const mismatch = provider === 'groq' && selectedModel !== actualModel;
    const base = `저장되었습니다. ${providerLabel(provider)} 키 → ${MODEL_LABELS[actualModel] || actualModel}로 실행됩니다.`;
    return mismatch ? base + ' (선택한 Gemini 모델 대신 Groq 기본 모델 자동 적용)' : base;
  }

  // ─── 저장된 설정 불러오기 ───
  chrome.storage.local.get(['apiKey', 'model', 'displayMode', 'warnDismissed'], (result) => {
    if (result.apiKey) {
      input.value = result.apiKey;
      updateInputStatus();
    }
    if (result.model) {
      modelSel.value = result.model;
      updateActiveTableRow();
    } else {
      updateActiveTableRow();
    }
    if (result.displayMode) {
      const r = document.querySelector(`input[name="displayMode"][value="${result.displayMode}"]`);
      if (r) {
        r.checked = true;
        updateActiveModeCard();
      }
    } else {
      updateActiveModeCard();
    }
    if (result.warnDismissed) warnBanner.style.display = 'none';
  });

  // ─── API 키 입력 → 체크 표시 ───
  function updateInputStatus() {
    const v = input.value.trim();
    if (v.length >= 10) {
      inputStatus.textContent = '✓';
      inputStatus.style.color = 'oklch(0.55 0.18 155)';
    } else {
      inputStatus.textContent = '';
    }
  }
  input.addEventListener('input', updateInputStatus);

  // ─── 모델 셀렉트 → 활성 행 표시 ───
  function updateActiveTableRow() {
    const selected = modelSel.value;
    modelTable.querySelectorAll('.settings2-table-row[data-model]').forEach(row => {
      row.classList.toggle('active', row.dataset.model === selected);
    });
  }
  modelSel.addEventListener('change', updateActiveTableRow);

  // 테이블 행 클릭 → 셀렉트 변경
  modelTable.addEventListener('click', (e) => {
    const row = e.target.closest('.settings2-table-row[data-model]');
    if (!row) return;
    modelSel.value = row.dataset.model;
    updateActiveTableRow();
  });

  // ─── 모드 카드 활성 표시 ───
  function updateActiveModeCard() {
    const checked = document.querySelector('input[name="displayMode"]:checked')?.value;
    modeGroup.querySelectorAll('.settings2-mode').forEach(card => {
      card.classList.toggle('checked', card.dataset.mode === checked);
    });
  }
  modeGroup.addEventListener('change', updateActiveModeCard);

  function getSelectedDisplayMode() {
    return document.querySelector('input[name="displayMode"]:checked')?.value || 'sidepanel';
  }

  // ─── 과금 경고 닫기 ───
  warnClose.addEventListener('click', async () => {
    warnBanner.style.display = 'none';
    await chrome.storage.local.set({ warnDismissed: true });
  });

  // ─── 상태 메시지 ───
  function showStatus(msg, ok, ms = 4000) {
    statusEl.textContent = msg;
    statusEl.className = 'settings2-status ' + (ok ? 'ok' : 'err');
    statusEl.style.display = 'block';
    if (ms > 0) {
      setTimeout(() => { statusEl.style.display = 'none'; }, ms);
    }
  }

  // ─── 저장 ───
  saveBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) return showStatus('API 키를 입력해주세요.', false);
    if (key.length < 10) return showStatus('API 키가 너무 짧습니다.', false);
    try {
      await chrome.storage.local.set({
        apiKey: key,
        model: modelSel.value,
        displayMode: getSelectedDisplayMode(),
      });
      showStatus(buildSaveMessage(key, modelSel.value), true, 6000);
    } catch (e) {
      showStatus('저장 실패: ' + e.message, false);
    }
  });

  // ─── 삭제 ───
  deleteBtn.addEventListener('click', async () => {
    if (!input.value.trim()) {
      return showStatus('삭제할 키가 없습니다.', false);
    }
    const ok = confirm('저장된 API 키를 삭제하시겠습니까?\n\n삭제 후 다시 분석하려면 키를 재입력해야 합니다.\n(모델 선택과 분석 히스토리는 유지됩니다.)');
    if (!ok) return;
    try {
      await chrome.storage.local.remove('apiKey');
      input.value = '';
      updateInputStatus();
      showStatus('API 키가 삭제되었습니다.', true);
    } catch (e) {
      showStatus('삭제 실패: ' + e.message, false);
    }
  });
})();
