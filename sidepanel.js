// sidepanel.js — 결과 렌더링 및 드릴다운 UI

const MAX_DRILL_DEPTH = 2;
const MAX_HISTORY = 10;
const DRILLDOWN_TIMEOUT_MS = 60000;

let port;
let messageReceived = false;  // background로부터 메시지 한번이라도 받았는지

// ── 포트 연결 (서비스워커 재시작 시 자동 재연결) ──
function connectPort() {
  port = chrome.runtime.connect({ name: 'sidepanel' });
  port.onMessage.addListener((msg) => {
    messageReceived = true;
    switch (msg.type) {
      case 'loading':
        showState('loading');
        break;

      case 'result':
        if (msg.data.type === 'word') {
          renderWordResult(msg.data.data);
          showState('word-result');
        } else {
          renderResult(msg.data);
          showState('result');
          saveToHistory(msg.data);
        }
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
  port.onDisconnect.addListener(() => connectPort());
}

connectPort();

// ── 상태 관리 ──
const states = {
  empty:    document.getElementById('state-empty'),
  'no-key': document.getElementById('state-no-key'),
  loading:  document.getElementById('state-loading'),
  error:    document.getElementById('state-error'),
  result:   document.getElementById('state-result'),
  'word-result': document.getElementById('state-word-result'),
};

function showState(name) {
  Object.entries(states).forEach(([k, el]) => {
    if (el) el.style.display = k === name ? '' : 'none';
  });
}

// ── 초기 상태: 키 유무 체크 후 분기 ──
// race condition 방지: background가 이미 메시지(loading/result/error)를 보냈으면
// 그 상태를 덮어쓰지 않음
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (messageReceived) return;
  showState(apiKey ? 'empty' : 'no-key');
});

// 키 저장 변경 감지 — welcome/options에서 키 저장 시 빈 상태 갱신
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiKey) {
    const hasKey = !!changes.apiKey.newValue;
    // 결과/로딩/에러 상태가 아닐 때만 빈 상태 갱신
    const resultVisible = states.result?.style.display !== 'none'
      || states['word-result']?.style.display !== 'none'
      || states.loading?.style.display !== 'none'
      || states.error?.style.display !== 'none';
    if (!resultVisible) showState(hasKey ? 'empty' : 'no-key');
  }
});

// "시작하기" 버튼 → welcome 페이지 오픈
document.getElementById('open-welcome-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

// ── 옵션 버튼 ──
document.getElementById('api-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── 히스토리 버튼 ──
const historyPanel = document.getElementById('history-panel');
document.getElementById('history-btn').addEventListener('click', () => {
  const visible = historyPanel.style.display !== 'none';
  historyPanel.style.display = visible ? 'none' : '';
  if (!visible) renderHistory();
});
document.getElementById('history-close').addEventListener('click', () => {
  historyPanel.style.display = 'none';
});


// ════════════════════════════════════════════════
// 히스토리 저장/불러오기
// ════════════════════════════════════════════════
async function saveToHistory(data) {
  const { history = [] } = await chrome.storage.local.get('history');
  const entry = {
    text: data.original || data.normalized || '',
    translation: data.translation || '',
    timestamp: Date.now(),
    data,
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ history });
}

async function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  const { history = [] } = await chrome.storage.local.get('history');
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '분석 기록이 없습니다.';
    list.appendChild(empty);
    return;
  }
  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const text = document.createElement('div');
    text.className = 'history-item-text';
    text.textContent = entry.text;
    item.appendChild(text);

    const time = document.createElement('div');
    time.className = 'history-item-time';
    time.textContent = formatTime(entry.timestamp);
    item.appendChild(time);

    item.addEventListener('click', () => {
      renderResult(entry.data);
      showState('result');
      historyPanel.style.display = 'none';
    });
    list.appendChild(item);
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}


// ════════════════════════════════════════════════
// 에러 렌더링
// ════════════════════════════════════════════════
function renderError(message, errorType) {
  document.getElementById('error-msg').textContent = message;
  const optBtn = document.getElementById('options-btn');
  optBtn.style.display = errorType === 'auth' ? '' : 'none';
}


// ════════════════════════════════════════════════
// 단어 사전 결과 렌더링
// ════════════════════════════════════════════════
function renderWordResult(data) {
  document.getElementById('word-title').textContent = data.word || '';
  document.getElementById('word-pron').textContent = data.pronunciation || '';
  document.getElementById('word-pos-badge').textContent = data.pos || '';
  document.getElementById('word-definition').textContent = data.definition || '';
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
  const drillable = item.has_substructure && depth < MAX_DRILL_DEPTH;
  if (drillable) chip.classList.add('drillable');

  // 역할 레이블 + 드릴다운 인디케이터 (별도 시각 스타일)
  const headerEl = document.createElement('div');
  headerEl.className = 'chip-header';

  const roleEl = document.createElement('span');
  roleEl.className = 'chip-role';
  roleEl.textContent = roleLabel(item.role);
  headerEl.appendChild(roleEl);

  let drillEl = null;
  if (drillable) {
    drillEl = document.createElement('span');
    drillEl.className = 'chip-drill';
    drillEl.textContent = '▸ 상세분석';
    headerEl.appendChild(drillEl);
  }
  chip.appendChild(headerEl);

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
  if (drillable) {
    let expanded = false;
    let panel = null;
    let timeoutId = null;

    chip.addEventListener('click', () => {
      if (!expanded) {
        expanded = true;
        chip.classList.add('expanded');
        if (drillEl) drillEl.textContent = '▾ 접기';

        const requestId = `dd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        panel = document.createElement('div');
        panel.className = 'drilldown-panel';
        panel.dataset.requestId = requestId;
        panel.dataset.depth = depth;
        panel.innerHTML = '<div class="drilldown-loading"><span class="spinner"></span> 분석 중...</div>';
        wrapper.appendChild(panel);

        // 타임아웃
        timeoutId = setTimeout(() => {
          if (panel && panel.querySelector('.drilldown-loading')) {
            panel.innerHTML = '';
            const errDiv = document.createElement('div');
            errDiv.className = 'drilldown-error';
            errDiv.textContent = '시간 초과 — 클릭하여 닫기';
            panel.appendChild(errDiv);
          }
        }, DRILLDOWN_TIMEOUT_MS);

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
        if (drillEl) drillEl.textContent = '▸ 상세분석';
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
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
  const panel = document.querySelector(`[data-request-id="${msg.requestId}"]`);
  if (!panel) return;

  if (msg.type === 'drilldown_error') {
    panel.innerHTML = '';
    const errDiv = document.createElement('div');
    errDiv.className = 'drilldown-error';
    errDiv.textContent = `오류: ${msg.message} — 클릭하여 닫기`;
    panel.appendChild(errDiv);
    return;
  }

  const { grammar, translation } = msg.data;
  panel.innerHTML = '';

  const parentDepth = parseInt(panel.dataset.depth || '0', 10);
  const layerNum = parentDepth + 1;

  // 레이어 라벨 (사용자 표시용은 내부 레이어 + 1)
  const label = document.createElement('div');
  label.className = 'drilldown-label';
  label.textContent = `LAYER ${layerNum + 1} —`;
  panel.appendChild(label);

  // 칩 행
  const chipRow = document.createElement('div');
  chipRow.className = 'chip-row';
  chipRow.style.marginTop = '6px';
  (grammar || []).forEach(item => {
    chipRow.appendChild(createChip(item, layerNum));
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
  v: 'v (준동사)',
  o: 'o (목적어)',
  c: 'c (보어)',
  a: 'a (부사어)',
  relclause: 'REL (관계절)',
  participle: 'PART (분사)',
  adjective: 'ADJ (형용사)',
};

function roleLabel(role) {
  return ROLE_LABELS[role] || role.toUpperCase();
}
