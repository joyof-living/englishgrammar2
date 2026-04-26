// sidepanel-v2.js — Phase B: 백엔드 결선 + v2 UI
// v1 sidepanel.js의 기능을 모두 보존하면서 v2 디자인으로 렌더링.
// 데이터 흐름 (port 메시지, drilldown async, history, errors)은 v1과 동일.

(() => {
  // ════════════════════════════════════════════════
  // 상수
  // ════════════════════════════════════════════════
  const MAX_DRILL_DEPTH = 2;          // depth 0(L1) → 1(L2) → 2(L3) — 그 이상 X
  const MAX_HISTORY = 10;
  const DRILLDOWN_TIMEOUT_MS = 60000;
  const DEV_MODE = new URLSearchParams(location.search).has('devmode');

  // ════════════════════════════════════════════════
  // v1 → v2 role 매핑
  // ════════════════════════════════════════════════
  // v2 톤 시스템: s/v/o/c/a/conj/mod/mv (analysis-v2.css 기준)
  const ROLE_MAP = {
    // Layer 0 (대문자)
    'S':            { up: 'S',    ko: '주어',   tone: 's' },
    'V':            { up: 'V',    ko: '동사',   tone: 'v' },
    'O':            { up: 'O',    ko: '목적어', tone: 'o' },
    'C':            { up: 'C',    ko: '보어',   tone: 'c' },
    'A':            { up: 'A',    ko: '부사어', tone: 'a' },
    'conj':         { up: 'CONJ', ko: '접속',   tone: 'conj' },
    'interjection': { up: 'INTER',ko: '독립어', tone: 'mod' },
    // Layer 1 (구문 분해)
    'MV':           { up: 'MV',   ko: '조동사', tone: 'mv' },
    'prep':         { up: 'PREP', ko: '전치사', tone: 'o' },
    'head':         { up: 'HEAD', ko: '핵심어', tone: 'c' },
    'modifier':     { up: 'MOD',  ko: '수식어', tone: 'mod' },
    'adv':          { up: 'ADV',  ko: '부사',   tone: 'a' },
    // 비한정 (소문자)
    'v':            { up: 'v',    ko: '준동사', tone: 'v' },
    'o':            { up: 'o',    ko: '목적어', tone: 'o' },
    'c':            { up: 'c',    ko: '보어',   tone: 'c' },
    'a':            { up: 'a',    ko: '부사어', tone: 'a' },
    // 기타
    'relclause':    { up: 'REL',  ko: '관계절', tone: 'mod' },
    'participle':   { up: 'PART', ko: '분사',   tone: 'mod' },
    'adjective':    { up: 'ADJ',  ko: '형용사', tone: 'mod' },
  };

  function roleMeta(role) {
    return ROLE_MAP[role] || { up: String(role).toUpperCase(), ko: '', tone: 'mod' };
  }

  // ════════════════════════════════════════════════
  // DOM 헬퍼
  // ════════════════════════════════════════════════
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'className') node.className = v;
      else if (k === 'onClick') node.addEventListener('click', v);
      else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      }
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  // ════════════════════════════════════════════════
  // 어댑터: v1 item → v2 item
  // ════════════════════════════════════════════════
  function adaptItem(v1Item) {
    const meta = roleMeta(v1Item.role);
    const tagParts = [];
    if (v1Item.tense) tagParts.push(v1Item.tense);
    if (v1Item.voice) tagParts.push(v1Item.voice);
    return {
      _v1Role: v1Item.role,        // 드릴다운 시 parentRole로 전달
      _v1Text: v1Item.text || '',  // 드릴다운 시 분석 대상 텍스트
      role: meta.up,
      ko: meta.ko,
      tone: meta.tone,
      en: v1Item.text || '',
      trans: v1Item.korean || '',
      expandable: !!v1Item.has_substructure,
      tag: tagParts.length ? tagParts.join(' · ') : null,
    };
  }

  // ════════════════════════════════════════════════
  // 컴포넌트들
  // ════════════════════════════════════════════════

  function SourceSentence(raw) {
    const wordCount = raw.trim().split(/\s+/).filter(Boolean).length;
    return el('div', { className: 'source-v2' },
      el('div', { className: 'source-v2-eyebrow' },
        el('span', { className: 'source-v2-dot' }),
        el('span', {}, '원문'),
        el('span', { className: 'source-v2-meta en' }, `${wordCount} words`),
      ),
      el('div', { className: 'source-v2-text en' }, raw),
    );
  }

  function Translation(ko) {
    return el('div', { className: 'trans-v2' },
      el('div', { className: 'trans-v2-eyebrow' },
        el('span', { className: 'trans-v2-dot' }),
        el('span', {}, '번역'),
      ),
      el('div', { className: 'trans-v2-text' }, ko || ''),
    );
  }

  function RefineBanner(notes, original, normalized) {
    if (!notes) return null;
    const head = el('div', { className: 'refine-v2-head' },
      el('span', { className: 'refine-v2-icon' }, '✎'),
      el('span', { className: 'refine-v2-label' }, '정제됨'),
      el('span', { className: 'refine-v2-note' }, notes),
    );
    const root = el('div', { className: 'refine-v2' }, head);

    if (original && normalized && original !== normalized) {
      root.appendChild(el('div', { className: 'refine-v2-compare' },
        el('div', { className: 'refine-v2-row before' },
          el('span', { className: 'refine-v2-tag' }, '원문'),
          el('span', { className: 'refine-v2-text en' }, original),
        ),
        el('div', { className: 'refine-v2-row after' },
          el('span', { className: 'refine-v2-tag accent' }, '정제'),
          el('span', { className: 'refine-v2-text en' }, normalized),
        ),
      ));
    }
    return root;
  }

  // SVOCA 카드 — 확장 시 카드 안 layer2-slot에 자식 rail 채움.
  // depth: 0 (Layer1 root), 1 (Layer2), 2 (Layer3)
  function SvocaCard(item, depth) {
    const tone = item.tone;
    const drillable = item.expandable && depth < MAX_DRILL_DEPTH;
    const layerN = depth + 2; // 다음 레이어 번호 (depth 0 → "LAYER 2")

    const head = el('div', { className: 'v2-head' },
      el('span', { className: `svoca-pill ${tone}-tone` },
        el('span', { className: 'role en' }, item.role),
        el('span', { className: 'ko' }, item.ko ? `(${item.ko})` : ''),
      ),
      item.tag ? el('span', { className: 'v2-tag en' }, item.tag) : null,
    );

    const body = el('div', { className: 'v2-body' },
      head,
      el('div', { className: 'v2-en en' }, item.en),
      item.trans ? el('div', { className: 'v2-ko' }, item.trans) : null,
    );

    let slot = null;
    if (drillable) {
      // 펼치기 버튼
      const btn = el('button', {
        className: 'expand-btn-v2',
        type: 'button',
        'aria-expanded': 'false',
      },
        el('span', { className: 'caret' }, '▸'),
        el('span', { className: 'label' }, '한 단계 더 분해'),
      );
      // 슬롯 (분석 결과가 비동기로 채워짐)
      slot = el('div', {
        className: 'layer2-slot',
        dataset: { parentDepth: String(depth) },
      });

      btn.addEventListener('click', () => toggleDrilldown(btn, slot, item, depth));
      body.appendChild(btn);
      body.appendChild(slot);
    }

    return el('div', { className: `svoca-v2 tone-${tone}` },
      el('div', { className: 'v2-bar' }),
      body,
    );
  }

  function LayerRail(depth, childCards, summary) {
    const cardsWrap = el('div', { className: 'rail-cards-v2' });
    childCards.forEach(c => cardsWrap.appendChild(c));
    const root = el('div', { className: 'layer-rail-v2-x' },
      el('div', { className: 'rail-head-v2' },
        el('span', { className: 'rail-label en' }, `LAYER ${depth}`),
        el('span', { className: 'rail-hint' }, '한 단계 더 분해'),
      ),
      cardsWrap,
    );
    if (summary) {
      root.appendChild(el('div', { className: 'rail-summary-v2' }, summary));
    }
    return root;
  }

  // 로딩 스켈레톤 (드릴다운 슬롯 안)
  function railSkeleton(depth) {
    const card = (extraSkel) => el('div', { className: 'rail-skel-card' },
      el('div', { className: 'v2-bar' }),
      el('div', { className: 'skel-body' },
        el('div', { className: 'skel skel-pill' }),
        el('div', { className: 'skel skel-mid' }),
        ...(extraSkel || []),
      ),
    );
    return el('div', { className: 'layer-rail-v2-x' },
      el('div', { className: 'rail-head-v2' },
        el('span', { className: 'rail-label en' }, `LAYER ${depth}`),
        el('span', { className: 'rail-hint' }, '분석 중...'),
      ),
      el('div', { className: 'rail-cards-v2' },
        card([el('div', { className: 'skel skel-short' })]),
        card(),
        card([el('div', { className: 'skel skel-short' })]),
      ),
    );
  }

  // ════════════════════════════════════════════════
  // 드릴다운 비동기 처리 (slot 패턴)
  // ════════════════════════════════════════════════
  // 각 슬롯은 data-request-id 로 응답을 매칭.
  // 슬롯 비어있으면 collapsed, 채워져 있으면 expanded.

  const drilldownTimeouts = new Map(); // requestId → timeoutId

  function toggleDrilldown(btn, slot, item, depth) {
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    if (isExpanded) {
      // 접기
      btn.setAttribute('aria-expanded', 'false');
      btn.querySelector('.caret').textContent = '▸';
      btn.querySelector('.label').textContent = '한 단계 더 분해';
      const oldRid = slot.dataset.requestId;
      if (oldRid && drilldownTimeouts.has(oldRid)) {
        clearTimeout(drilldownTimeouts.get(oldRid));
        drilldownTimeouts.delete(oldRid);
      }
      slot.innerHTML = '';
      slot.removeAttribute('data-request-id');
      return;
    }

    // 펼치기
    btn.setAttribute('aria-expanded', 'true');
    btn.querySelector('.caret').textContent = '▾';
    btn.querySelector('.label').textContent = '접기';

    const requestId = `dd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    slot.dataset.requestId = requestId;
    slot.innerHTML = '';
    slot.appendChild(railSkeleton(depth + 2));

    // 타임아웃
    const tid = setTimeout(() => {
      drilldownTimeouts.delete(requestId);
      // 응답 안 옴 → slot 안에 에러 메시지
      const targetSlot = document.querySelector(`.layer2-slot[data-request-id="${requestId}"]`);
      if (!targetSlot) return;
      targetSlot.innerHTML = '';
      const errEl = el('div', { className: 'rail-skel-error' },
        '시간 초과 — 클릭하여 닫기',
      );
      errEl.addEventListener('click', () => {
        targetSlot.innerHTML = '';
        targetSlot.removeAttribute('data-request-id');
        btn.setAttribute('aria-expanded', 'false');
        btn.querySelector('.caret').textContent = '▸';
        btn.querySelector('.label').textContent = '한 단계 더 분해';
      });
      targetSlot.appendChild(errEl);
    }, DRILLDOWN_TIMEOUT_MS);
    drilldownTimeouts.set(requestId, tid);

    if (port) {
      port.postMessage({
        type: 'drilldown',
        text: item._v1Text,
        parentRole: item._v1Role,
        requestId,
      });
    }
  }

  function handleDrilldownResponse(msg) {
    const slot = document.querySelector(`.layer2-slot[data-request-id="${msg.requestId}"]`);
    if (!slot) return; // collapsed 또는 stale

    if (drilldownTimeouts.has(msg.requestId)) {
      clearTimeout(drilldownTimeouts.get(msg.requestId));
      drilldownTimeouts.delete(msg.requestId);
    }

    if (msg.type === 'drilldown_error') {
      slot.innerHTML = '';
      const errEl = el('div', { className: 'rail-skel-error' },
        `오류: ${msg.message} — 클릭하여 닫기`,
      );
      const btn = slot.parentElement?.querySelector('.expand-btn-v2');
      errEl.addEventListener('click', () => {
        slot.innerHTML = '';
        slot.removeAttribute('data-request-id');
        if (btn) {
          btn.setAttribute('aria-expanded', 'false');
          btn.querySelector('.caret').textContent = '▸';
          btn.querySelector('.label').textContent = '한 단계 더 분해';
        }
      });
      slot.appendChild(errEl);
      return;
    }

    // drilldown_result
    const parentDepth = parseInt(slot.dataset.parentDepth || '0', 10);
    const childDepth = parentDepth + 1;
    const layerN = childDepth + 1; // displayed (depth 0 root → child = 1 = "LAYER 2")

    const items = (msg.data?.grammar || []).map(adaptItem);
    const cards = items.map(it => SvocaCard(it, childDepth));
    const rail = LayerRail(layerN, cards, msg.data?.translation);

    slot.innerHTML = '';
    slot.appendChild(rail);
  }

  // ════════════════════════════════════════════════
  // 메인 결과 렌더
  // ════════════════════════════════════════════════
  function renderResult(data) {
    // data: { type:'grammar', original, normalized, normalization_notes, translation, grammar[], words[] }
    const root = el('div', { className: 'sp2-result' });
    const analysis = el('div', { className: 'analysis-v2' });

    // 정제 알림 + 비교
    const refineBox = RefineBanner(data.normalization_notes, data.original, data.normalized);
    if (refineBox) analysis.appendChild(refineBox);

    // 원문 (정제된 문장이 우선)
    analysis.appendChild(SourceSentence(data.normalized || data.original || ''));

    // 번역
    analysis.appendChild(Translation(data.translation || ''));

    // 문장 구조
    const section = el('section', { className: 'result-v2-section' },
      el('div', { className: 'result-v2-section-head' },
        el('span', { className: 'dot' }),
        el('h3', {}, '문장 구조'),
        el('span', { className: 'head-hint en' }, 'SVOCA'),
      ),
    );
    const layer1 = el('div', { className: 'layer1-stack' });
    (data.grammar || []).forEach(v1Item => {
      const item = adaptItem(v1Item);
      layer1.appendChild(SvocaCard(item, 0));
    });
    section.appendChild(layer1);
    analysis.appendChild(section);

    root.appendChild(analysis);

    // 단어 섹션
    if (data.words && data.words.length) {
      root.appendChild(renderWords(data.words));
    }

    return root;
  }

  function renderWords(words) {
    const section = el('section', { className: 'sp2-words' },
      el('div', { className: 'sp2-words-head' },
        el('span', { className: 'dot' }),
        el('h3', {}, '단어'),
      ),
    );
    const list = el('div', { className: 'sp2-words-list' });
    if (!words.length) {
      list.appendChild(el('div', { className: 'sp2-word-empty' }, '단어 정보 없음'));
    } else {
      words.forEach(w => {
        const item = el('div', { className: 'sp2-word-item' });
        const left = el('div');
        left.appendChild(el('span', { className: 'sp2-word-en en' }, w.word || ''));
        if (w.pronunciation) {
          left.appendChild(el('span', { className: 'sp2-word-pron en' }, w.pronunciation));
        }
        item.appendChild(left);
        item.appendChild(el('span', { className: 'sp2-word-pos en' }, (w.pos || '').slice(0, 6)));
        item.appendChild(el('div', { className: 'sp2-word-def' }, w.definition || ''));
        list.appendChild(item);
      });
    }
    section.appendChild(list);
    return section;
  }

  // ════════════════════════════════════════════════
  // 단어 사전 결과 (단일 단어)
  // ════════════════════════════════════════════════
  function renderWordResult(data) {
    return el('div', { className: 'sp2-word-card' },
      el('div', { className: 'word-title en' }, data.word || ''),
      data.pronunciation ? el('div', { className: 'word-pron en' }, data.pronunciation) : null,
      data.pos ? el('span', { className: 'word-pos en' }, data.pos) : null,
      data.definition ? el('div', { className: 'word-def' }, data.definition) : null,
    );
  }

  // ════════════════════════════════════════════════
  // 빈 / 키 없음 / 에러 / 로딩 상태
  // ════════════════════════════════════════════════
  function renderEmpty() {
    const root = el('div', { className: 'sp2-state' });
    if (window.createMascot) {
      root.appendChild(window.createMascot({ size: 88, expression: 'happy', showBlocks: true }));
    }
    root.appendChild(el('h3', {}, '문장을 골라주세요'));
    root.appendChild(el('p', {}, '웹페이지에서 영어 문장을 선택하면 분석이 시작됩니다.'));
    root.appendChild(el('p', { className: 'sp2-state-hint' }, '최대 300단어까지 분석 가능합니다.'));
    return root;
  }

  function renderNoKey() {
    const root = el('div', { className: 'sp2-state' });
    if (window.createMascot) {
      root.appendChild(window.createMascot({ size: 88, expression: 'happy', showBlocks: false }));
    }
    root.appendChild(el('h3', {}, '시작하려면 API 키가 필요합니다'));
    root.appendChild(el('p', {}, '무료로 발급받을 수 있습니다 (1~2분 소요)'));
    const cta = el('button', { className: 'sp2-link-btn', type: 'button' }, '시작하기 →');
    cta.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    });
    root.appendChild(cta);
    return root;
  }

  function renderError(message, errorType) {
    const root = el('div', { className: 'sp2-state' });
    root.appendChild(el('div', { className: 'sp2-state-icon-emoji' }, '⚠️'));
    root.appendChild(el('p', { className: 'sp2-state-error' }, message || '오류가 발생했습니다.'));
    if (errorType === 'auth') {
      const btn = el('button', { className: 'sp2-link-btn', type: 'button' }, 'API 키 설정 →');
      btn.addEventListener('click', () => chrome.runtime.openOptionsPage());
      root.appendChild(btn);
    }
    return root;
  }

  function renderLoading() {
    const root = el('div', { className: 'sp2-loading' });
    // 원문 스켈레톤
    root.appendChild(el('div', { className: 'sp2-loading-card with-bar' },
      el('div', { className: 'skel skel-long' }),
      el('div', { className: 'skel skel-mid' }),
    ));
    // 번역 스켈레톤
    root.appendChild(el('div', { className: 'sp2-loading-card' },
      el('div', { className: 'skel skel-long' }),
      el('div', { className: 'skel skel-short' }),
    ));
    // SVOCA 카드 스켈레톤
    for (let i = 0; i < 3; i++) {
      root.appendChild(el('div', { className: 'sp2-loading-card with-bar' },
        el('div', { className: 'skel skel-pill' }),
        el('div', { className: 'skel skel-mid' }),
        el('div', { className: 'skel skel-short' }),
      ));
    }
    return root;
  }

  // ════════════════════════════════════════════════
  // 상태 표시 (sp2-body 콘텐츠 교체)
  // ════════════════════════════════════════════════
  const body = document.getElementById('sp2-body');

  function setBody(node) {
    body.innerHTML = '';
    if (node) body.appendChild(node);
  }

  function showEmpty()       { setBody(renderEmpty()); }
  function showNoKey()       { setBody(renderNoKey()); }
  function showLoading()     { setBody(renderLoading()); }
  function showError(m, t)   { setBody(renderError(m, t)); }
  function showResult(data)  { setBody(renderResult(data)); }
  function showWordResult(d) { setBody(renderWordResult(d)); }

  // ════════════════════════════════════════════════
  // 포트 연결 + 메시지 라우팅
  // ════════════════════════════════════════════════
  let port = null;
  let messageReceived = false;

  function connectPort() {
    port = chrome.runtime.connect({ name: 'sidepanel' });
    port.onMessage.addListener((msg) => {
      messageReceived = true;
      switch (msg.type) {
        case 'loading':
          showLoading();
          break;
        case 'result':
          if (msg.data?.type === 'word') {
            showWordResult(msg.data.data);
          } else {
            showResult(msg.data);
            saveToHistory(msg.data);
          }
          break;
        case 'error':
          showError(msg.message, msg.errorType);
          break;
        case 'drilldown_result':
        case 'drilldown_error':
          handleDrilldownResponse(msg);
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // 서비스워커 재시작 시 재연결
      setTimeout(connectPort, 100);
    });
  }

  // ════════════════════════════════════════════════
  // 초기 상태 결정 (키 유무 + race condition 보호)
  // ════════════════════════════════════════════════
  chrome.storage.local.get('apiKey', ({ apiKey }) => {
    if (messageReceived) return;
    if (apiKey) showEmpty();
    else showNoKey();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.apiKey) {
      const hasKey = !!changes.apiKey.newValue;
      // 결과/로딩/에러가 표시 중이면 덮어쓰지 않음
      const firstChild = body.firstElementChild;
      const isStateScreen = firstChild?.classList?.contains('sp2-state');
      if (isStateScreen) {
        if (hasKey) showEmpty();
        else showNoKey();
      }
    }
  });

  // ════════════════════════════════════════════════
  // 히스토리 (chrome.storage.local)
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
      list.appendChild(el('div', { className: 'sp2-history-empty' }, '분석 기록이 없습니다.'));
      return;
    }
    history.forEach(entry => {
      const item = el('div', { className: 'sp2-history-item' },
        el('div', { className: 'sp2-history-item-text' }, entry.text || ''),
        el('div', { className: 'sp2-history-item-time' }, formatTime(entry.timestamp)),
      );
      item.addEventListener('click', () => {
        showResult(entry.data);
        document.getElementById('history-panel').hidden = true;
      });
      list.appendChild(item);
    });
  }

  function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return '방금 전';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
    return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  }

  // ════════════════════════════════════════════════
  // 헤더 마스코트 + 버튼 핸들러
  // ════════════════════════════════════════════════
  const headerMascotEl = document.getElementById('header-mascot');
  if (headerMascotEl && window.createMascot) {
    headerMascotEl.appendChild(window.createMascot({ size: 22, expression: 'happy' }));
  }

  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const historyPanel = document.getElementById('history-panel');
  document.getElementById('history-btn').addEventListener('click', () => {
    if (historyPanel.hidden) {
      historyPanel.hidden = false;
      renderHistory();
    } else {
      historyPanel.hidden = true;
    }
  });
  document.getElementById('history-close').addEventListener('click', () => {
    historyPanel.hidden = true;
  });

  // ════════════════════════════════════════════════
  // DEV 모드: 샘플 토글 바
  // ════════════════════════════════════════════════
  if (DEV_MODE) {
    const sampleBar = document.getElementById('sample-bar');
    const SAMPLE_KEYS = ['coffee', 'economy', 'abc_news', 'renaissance', 'microsoft'];
    const SAMPLE_LABELS = {
      coffee: 'Coffee', economy: 'Economy', abc_news: 'ABC News',
      renaissance: 'Renaissance', microsoft: 'Microsoft',
    };
    sampleBar.hidden = false;

    SAMPLE_KEYS.forEach(key => {
      const btn = el('button', { className: 'sample-btn', type: 'button' }, SAMPLE_LABELS[key]);
      btn.addEventListener('click', () => {
        // v2 sample → v1-shape 어댑터 (간이)
        const s = window.SAMPLES?.[key];
        if (!s) return;
        const fakeData = {
          type: 'grammar',
          original: s.refineOriginal || s.raw,
          normalized: s.raw,
          normalization_notes: s.refine?.note || '',
          translation: s.ko,
          grammar: s.layer1.map(it => ({
            role: it.role,
            text: it.en,
            korean: it.trans,
            has_substructure: !!it.expandable,
            tense: it.tag?.split(' · ')?.[0]?.includes('present') || it.tag?.split(' · ')?.[0]?.includes('past') ? it.tag.split(' · ')[0] : undefined,
            voice: it.tag?.includes('active') ? 'active' : it.tag?.includes('passive') ? 'passive' : undefined,
          })),
          words: [],
        };
        showResult(fakeData);
        sampleBar.querySelectorAll('.sample-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      sampleBar.appendChild(btn);
    });
  }

  // ════════════════════════════════════════════════
  // 시작
  // ════════════════════════════════════════════════
  connectPort();

  // 외부 노출 (디버깅 용)
  window.SVOCAtV2 = { showEmpty, showResult, showLoading, showError, adaptItem };
})();
