// sidepanel.js — 결과 렌더링 및 드릴다운 UI

const port = chrome.runtime.connect({ name: 'sidepanel' });
let drilldownCounter = 0;

// ── 상태 관리 ──
const states = {
  empty:   document.getElementById('state-empty'),
  loading: document.getElementById('state-loading'),
  error:   document.getElementById('state-error'),
  result:  document.getElementById('state-result'),
};

function showState(name) {
  Object.entries(states).forEach(([k, el]) => {
    el.style.display = k === name ? '' : 'none';
  });
}

// ── 메시지 수신 ──
port.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'loading':
      showState('loading');
      break;

    case 'result':
      renderResult(msg.data);
      showState('result');
      break;

    case 'error':
      renderError(msg.message, msg.errorType);
      showState('error');
      break;

    case 'drilldown_result':
    case 'drilldown_error':
      handleDrilldownResponse(msg);
      break;
  }
});

// ── 초기 상태 ──
showState('empty');

// ── 옵션 버튼 ──
document.getElementById('api-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});


// ════════════════════════════════════════════════
// 에러 렌더링
// ════════════════════════════════════════════════
function renderError(message, errorType) {
  document.getElementById('error-msg').textContent = message;
  const optBtn = document.getElementById('options-btn');
  optBtn.style.display = errorType === 'auth' ? '' : 'none';
}


// ════════════════════════════════════════════════
// 메인 결과 렌더링
// ════════════════════════════════════════════════
function renderResult(data) {
  // 정제 알림
  const normNotice = document.getElementById('norm-notice');
  if (data.normalization_notes) {
    document.getElementById('norm-notes').textContent = data.normalization_notes;
    normNotice.style.display = '';
  } else {
    normNotice.style.display = 'none';
  }

  // 원문 (정제된 문장 표시)
  const sentenceBox = document.getElementById('sentence-box');
  sentenceBox.textContent = data.normalized || data.original;

  // 문장 구조
  const grammarWrap = document.getElementById('grammar-wrap');
  grammarWrap.innerHTML = '';
  const chipRow = document.createElement('div');
  chipRow.className = 'chip-row';
  (data.grammar || []).forEach(item => {
    chipRow.appendChild(createChip(item, 0));
  });
  grammarWrap.appendChild(chipRow);

  // 번역
  document.getElementById('translation-box').textContent = data.translation || '';

  // 단어
  renderWords(data.words || []);
}


// ════════════════════════════════════════════════
// 칩 생성
// ════════════════════════════════════════════════
function createChip(item, depth) {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'inline-flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.maxWidth = '100%';

  const chip = document.createElement('div');
  chip.className = `chip role-${item.role}`;
  if (item.has_substructure && depth < 3) chip.classList.add('drillable');

  // 역할 레이블
  const roleEl = document.createElement('span');
  roleEl.className = 'chip-role';
  roleEl.textContent = roleLabel(item.role) + (item.has_substructure && depth < 3 ? ' ▸' : '');
  chip.appendChild(roleEl);

  // 영어 텍스트
  const textEl = document.createElement('span');
  textEl.className = 'chip-text';
  textEl.textContent = item.text;
  chip.appendChild(textEl);

  // 한국어 설명
  if (item.korean) {
    const korEl = document.createElement('span');
    korEl.className = 'chip-korean';
    korEl.textContent = item.korean;
    chip.appendChild(korEl);
  }

  // V 노드: 시제/태 표시
  if (item.tense || item.voice) {
    const metaEl = document.createElement('span');
    metaEl.className = 'chip-meta';
    const parts = [];
    if (item.tense) parts.push(item.tense);
    if (item.voice) parts.push(item.voice);
    metaEl.textContent = parts.join(' · ');
    chip.appendChild(metaEl);
  }

  wrapper.appendChild(chip);

  // 드릴다운 기능
  if (item.has_substructure && depth < 3) {
    const requestId = `dd-${++drilldownCounter}`;
    let expanded = false;
    let panel = null;

    chip.addEventListener('click', () => {
      if (!expanded) {
        // 패널 열기
        expanded = true;
        chip.classList.add('expanded');
        roleEl.textContent = roleLabel(item.role) + ' ▾';

        panel = document.createElement('div');
        panel.className = 'drilldown-panel';
        panel.id = requestId;
        panel.innerHTML = '<div class="drilldown-loading">분석 중...</div>';
        wrapper.appendChild(panel);

        port.postMessage({
          type: 'drilldown',
          text: item.text,
          parentRole: item.role,
          requestId,
        });
      } else {
        // 패널 닫기
        expanded = false;
        chip.classList.remove('expanded');
        roleEl.textContent = roleLabel(item.role) + ' ▸';
        if (panel) { panel.remove(); panel = null; }
      }
    });
  }

  return wrapper;
}


// ════════════════════════════════════════════════
// 드릴다운 응답 처리
// ════════════════════════════════════════════════
function handleDrilldownResponse(msg) {
  const panel = document.getElementById(msg.requestId);
  if (!panel) return;

  if (msg.type === 'drilldown_error') {
    panel.innerHTML = `<div style="color:#dc2626;font-size:12px">오류: ${msg.message}</div>`;
    return;
  }

  const { grammar, translation } = msg.data;
  panel.innerHTML = '';

  // 레이어 라벨
  const layerLabel = document.createElement('div');
  layerLabel.className = 'drilldown-label';
  layerLabel.textContent = 'LAYER 1 —';
  panel.appendChild(layerLabel);

  // 칩 행
  const chipRow = document.createElement('div');
  chipRow.className = 'chip-row';
  chipRow.style.marginTop = '6px';
  (grammar || []).forEach(item => {
    chipRow.appendChild(createChip(item, 1));
  });
  panel.appendChild(chipRow);

  // 번역
  if (translation) {
    const transEl = document.createElement('div');
    transEl.className = 'drilldown-translation';
    transEl.textContent = translation;
    panel.appendChild(transEl);
  }
}


// ════════════════════════════════════════════════
// 단어 렌더링
// ════════════════════════════════════════════════
function renderWords(words) {
  const wrap = document.getElementById('words-wrap');
  wrap.innerHTML = '';
  if (!words.length) {
    wrap.innerHTML = '<div style="color:#94a3b8;font-size:13px">단어 정보 없음</div>';
    return;
  }
  words.forEach(w => {
    const item = document.createElement('div');
    item.className = 'word-item';

    const left = document.createElement('div');
    const wordEn = document.createElement('span');
    wordEn.className = 'word-en';
    wordEn.textContent = w.word;
    const wordPron = document.createElement('span');
    wordPron.className = 'word-pron';
    wordPron.textContent = w.pronunciation || '';
    left.appendChild(wordEn);
    left.appendChild(wordPron);

    const posBadge = document.createElement('span');
    posBadge.className = 'word-pos';
    posBadge.textContent = (w.pos || '').toLowerCase().slice(0, 6);

    const def = document.createElement('div');
    def.className = 'word-def';
    def.textContent = w.definition || '';

    item.appendChild(left);
    item.appendChild(posBadge);
    item.appendChild(def);
    wrap.appendChild(item);
  });
}


// ════════════════════════════════════════════════
// 역할 레이블 매핑
// ════════════════════════════════════════════════
const ROLE_LABELS = {
  S: 'S (주어)',
  V: 'V (동사)',
  O: 'O (목적어)',
  C: 'C (보어)',
  A: 'A (부사어)',
  conj: 'CONJ (접속)',
  interjection: 'INTER (독립어)',
  MV: 'MV (조동사)',
  prep: 'PREP (전치사)',
  head: 'HEAD (핵심어)',
  modifier: 'MOD (수식어)',
  adv: 'ADV (부사)',
  v: 'v (비한정동)',
  o: 'o (목적어)',
  c: 'c (보어)',
  a: 'a (부사어)',
};

function roleLabel(role) {
  return ROLE_LABELS[role] || role.toUpperCase();
}
