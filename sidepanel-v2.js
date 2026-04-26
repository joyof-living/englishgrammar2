// sidepanel-v2.js — Phase A 시각 검증용 사이드패널 렌더러
// Source: docs/UX guide/analysis-v2.jsx + sidepanel-v2.jsx
// 백엔드 미연결. SAMPLES 데이터를 직접 렌더.
// Phase B에서 backend 결선 시: renderAnalysis(data) 함수만 외부에서 호출.

(() => {
  // ─── 역할 라벨 매핑 ───
  const ROLE_LABEL = {
    S:    { ko: '주어',   tone: 's' },
    V:    { ko: '동사',   tone: 'v' },
    O:    { ko: '목적어', tone: 'o' },
    C:    { ko: '보어',   tone: 'c' },
    A:    { ko: '부사어', tone: 'a' },
    CONJ: { ko: '접속',   tone: 'conj' },
    MOD:  { ko: '수식어', tone: 'mod' },
    HEAD: { ko: '핵심어', tone: 'c' },
    PREP: { ko: '전치사', tone: 'o' },
    MV:   { ko: '조동사', tone: 'mv' },
    ADV:  { ko: '부사',   tone: 'a' },
  };

  // ─── DOM 헬퍼 ───
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
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  // ─── 컴포넌트: 원문 박스 ───
  function SourceSentenceV2(raw) {
    const wordCount = raw.trim().split(/\s+/).length;
    return el('div', { className: 'source-v2' },
      el('div', { className: 'source-v2-eyebrow' },
        el('span', { className: 'source-v2-dot' }),
        el('span', {}, '원문'),
        el('span', { className: 'source-v2-meta en' }, `${wordCount} words`),
      ),
      el('div', { className: 'source-v2-text en' }, raw),
    );
  }

  // ─── 컴포넌트: 번역 박스 ───
  function TranslationV2(ko) {
    return el('div', { className: 'trans-v2' },
      el('div', { className: 'trans-v2-eyebrow' },
        el('span', { className: 'trans-v2-dot' }),
        el('span', {}, '번역'),
      ),
      el('div', { className: 'trans-v2-text' }, ko),
    );
  }

  // ─── 컴포넌트: 정제 비교 박스 ───
  function RefineBannerV2(refine, original, refined) {
    if (!refine) return null;
    const head = el('div', { className: 'refine-v2-head' },
      el('span', { className: 'refine-v2-icon' }, '✎'),
      el('span', { className: 'refine-v2-label' }, refine.kind || '정제됨'),
      refine.note ? el('span', { className: 'refine-v2-note' }, refine.note) : null,
    );

    const root = el('div', { className: 'refine-v2' }, head);

    if (original && refined && original !== refined) {
      const compare = el('div', { className: 'refine-v2-compare' },
        el('div', { className: 'refine-v2-row before' },
          el('span', { className: 'refine-v2-tag' }, '원문'),
          el('span', { className: 'refine-v2-text en' }, original),
        ),
        el('div', { className: 'refine-v2-row after' },
          el('span', { className: 'refine-v2-tag accent' }, '정제'),
          el('span', { className: 'refine-v2-text en' }, refined),
        ),
      );
      root.appendChild(compare);
    }
    return root;
  }

  // ─── 컴포넌트: SVOCA 카드 v2 ───
  // expanded: boolean | undefined — 펼침 상태
  // onExpand: 펼치기 버튼 클릭 핸들러
  // childRail: 펼쳐졌을 때 카드 안에 들어갈 layer-rail-v2 노드
  function SvocaCardV2(item, layout, opts = {}) {
    const meta = ROLE_LABEL[item.role] || { ko: item.ko || '', tone: 'mod' };
    const tone = meta.tone;

    const head = el('div', { className: 'v2-head' },
      el('span', { className: `svoca-pill ${tone}-tone` },
        el('span', { className: 'role en' }, item.role),
        el('span', { className: 'ko' }, `(${item.ko || meta.ko})`),
      ),
      item.tag ? el('span', { className: 'v2-tag en' }, item.tag) : null,
    );

    const enText = el('div', { className: 'v2-en en' }, item.en);
    const koText = item.trans ? el('div', { className: 'v2-ko' }, item.trans) : null;

    const body = el('div', { className: 'v2-body' }, head, enText);
    if (koText) body.appendChild(koText);

    if (item.expandable) {
      const btn = el('button', {
        className: 'expand-btn-v2',
        type: 'button',
        'aria-expanded': opts.expanded ? 'true' : 'false',
      },
        el('span', { className: 'caret' }, opts.expanded ? '▾' : '▸'),
        el('span', {}, opts.expanded ? '접기' : '한 단계 더 분해'),
      );
      if (opts.onExpand) btn.addEventListener('click', opts.onExpand);
      body.appendChild(btn);
    }

    if (opts.childRail) body.appendChild(opts.childRail);

    return el('div', { className: `svoca-v2 tone-${tone} layout-${layout}` },
      el('div', { className: 'v2-bar' }),
      body,
    );
  }

  // ─── 컴포넌트: Layer Rail (자식 카드 컨테이너) ───
  function LayerRailV2(depth, childCards, summary) {
    const cardsWrap = el('div', { className: 'rail-cards-v2' });
    for (const c of childCards) cardsWrap.appendChild(c);

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

  // ─── 메인 렌더: 분석 결과 → DOM ───
  // sample 스키마: { raw, ko, refine?, refineOriginal?, layer1[], layer2For?, layer2[], layer2Trans? }
  function renderAnalysis(sample, expanded = {}, onToggle = null, layout = 'stack') {
    const root = el('div', { className: 'analysis-v2' });

    // 정제 비교 (정제 있을 때만)
    const refineBox = RefineBannerV2(
      sample.refine,
      sample.refineOriginal || null,
      sample.raw,
    );
    if (refineBox) root.appendChild(refineBox);

    // 원문 + 번역
    root.appendChild(SourceSentenceV2(sample.raw));
    root.appendChild(TranslationV2(sample.ko));

    // 문장 구조 섹션
    const section = el('section', { className: 'result-v2-section' },
      el('div', { className: 'result-v2-section-head' },
        el('span', { className: 'dot' }),
        el('h3', {}, '문장 구조'),
        el('span', { className: 'head-hint en' }, 'SVOCA'),
      ),
    );

    const cardsWrap = el('div', { className: `layer1-${layout}` });

    sample.layer1.forEach((item, idx) => {
      const isExpanded = !!expanded[idx];

      let childRail = null;
      if (sample.layer2For === idx && isExpanded && sample.layer2) {
        const subCards = sample.layer2.map(sub => SvocaCardV2(sub, layout));
        childRail = LayerRailV2(2, subCards, sample.layer2Trans);
      }

      const card = SvocaCardV2(item, layout, {
        expanded: isExpanded,
        onExpand: onToggle ? () => onToggle(idx) : null,
        childRail,
      });
      cardsWrap.appendChild(card);
    });

    section.appendChild(cardsWrap);
    root.appendChild(section);
    return root;
  }

  // ─── 빈 상태 ───
  function renderEmpty() {
    const mascot = window.createMascot({ size: 88, expression: 'happy', showBlocks: true });
    return el('div', { className: 'sp2-empty' },
      mascot,
      el('h3', {}, '문장을 골라주세요'),
      el('p', {}, '웹페이지에서 영어 문장을 선택하면 분석이 시작됩니다.'),
    );
  }

  // ─── 헤더 마스코트 주입 ───
  const headerMascotEl = document.getElementById('header-mascot');
  if (headerMascotEl && window.createMascot) {
    headerMascotEl.appendChild(window.createMascot({ size: 22, expression: 'happy' }));
  }

  // ─── 설정 버튼 ───
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    if (chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      console.log('[Phase A] settings clicked');
    }
  });

  // ─── 샘플 토글 (Phase A 미리보기 전용) ───
  const SAMPLE_KEYS = ['coffee', 'economy', 'abc_news', 'renaissance', 'microsoft'];
  const SAMPLE_LABELS = {
    coffee: 'Coffee',
    economy: 'Economy',
    abc_news: 'ABC News',
    renaissance: 'Renaissance',
    microsoft: 'Microsoft',
  };

  // ?sample=coffee URL 파라미터 지원 (디버깅 편의)
  const urlSample = new URLSearchParams(location.search).get('sample');
  let currentKey = (urlSample && SAMPLE_KEYS.includes(urlSample)) ? urlSample : 'coffee';
  let expanded = (() => {
    const s = window.SAMPLES?.[currentKey];
    return (s && typeof s.layer2For === 'number') ? { [s.layer2For]: true } : {};
  })();

  const body = document.getElementById('sp2-body');
  const sampleBar = document.getElementById('sample-bar');

  function rerender() {
    body.innerHTML = '';
    const sample = window.SAMPLES?.[currentKey];
    if (!sample) {
      body.appendChild(renderEmpty());
      return;
    }
    body.appendChild(renderAnalysis(sample, expanded, (idx) => {
      expanded = { ...expanded, [idx]: !expanded[idx] };
      rerender();
    }, 'stack'));
  }

  function buildSampleBar() {
    SAMPLE_KEYS.forEach(key => {
      const btn = el('button', {
        className: `sample-btn${key === currentKey ? ' active' : ''}`,
        type: 'button',
      }, SAMPLE_LABELS[key]);
      btn.addEventListener('click', () => {
        currentKey = key;
        // 새 샘플마다 layer2For 인덱스를 기본 펼침으로
        const s = window.SAMPLES[key];
        expanded = (s && typeof s.layer2For === 'number') ? { [s.layer2For]: true } : {};
        // active 토글
        sampleBar.querySelectorAll('.sample-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rerender();
      });
      sampleBar.appendChild(btn);
    });
  }

  buildSampleBar();
  rerender();

  // ─── Phase B 결선용 export ───
  window.SVOCAtV2 = { renderAnalysis, renderEmpty };
})();
