// samples.js — Sample SVOCA analyses (Phase A 시각 검증용)
// Source: docs/UX guide/samples.jsx
// 백엔드 결선 후엔 더 이상 사용되지 않음.

const SAMPLES = {
  abc_news: {
    raw: "A federal judge is raising concerns about whether Donald Trump's attempt to sue the IRS for $10 billion can proceed, signaling she could throw out the case because the president oversees the government entities he is suing.",
    ko: "연방 판사가 도널드 트럼프가 IRS를 상대로 100억 달러를 청구하는 소송이 진행될 수 있는지에 대해 우려를 제기하며, 대통령이 자신이 소송 중인 정부 기관을 감독하기 때문에 사건을 기각할 수 있음을 시사했습니다.",
    refine: null,
    layer1: [
      { role: "S", ko: "주어", en: "A federal judge", trans: "한 연방 판사가" },
      { role: "V", ko: "동사", en: "is raising", trans: "제기하고 있다", tag: "present · active", expandable: true },
      { role: "O", ko: "목적어", en: "concerns about whether Donald Trump's attempt to sue the IRS for $10 billion can proceed", trans: "트럼프가 IRS를 상대로 100억 달러를 청구하는 소송이 진행될 수 있는지에 대한 우려", expandable: true },
      { role: "A", ko: "부사어", en: ", signaling she could throw out the case because the president oversees the government entities he is suing", trans: "그녀가 그 사건을 기각할 수 있음을 시사하며", expandable: true },
    ],
  },
  coffee: {
    raw: "Coffee consumption boosts productivity, recent studies find.",
    ko: "커피 소비는 생산성을 높입니다, 최근 연구들에 따르면.",
    refine: { kind: "정제됨", note: "postposed reporting clause" },
    refineOriginal: "Coffee consumption boosts productivity, recent studies find.",
    layer1: [
      { role: "S", ko: "주어", en: "Coffee consumption", trans: "커피 소비" },
      { role: "V", ko: "동사", en: "boosts", trans: "높인다" },
      { role: "O", ko: "목적어", en: "productivity", trans: "생산성" },
      { role: "A", ko: "부사어", en: ", recent studies find", trans: "최근 연구들에 따르면", expandable: true },
    ],
    layer2For: 3,
    layer2: [
      { role: "CONJ", ko: "접속", en: ",", trans: "쉼표" },
      { role: "S", ko: "주어", en: "recent studies", trans: "최근 연구들" },
      { role: "V", ko: "동사", en: "find", trans: "발견하다", tag: "present · active" },
    ],
    layer2Trans: "최근 연구들이 발견하다",
  },
  economy: {
    raw: "The economy will recover by next year, analysts predict.",
    ko: "경제는 내년까지 회복될 것이라고 분석가들은 예측합니다.",
    refine: { kind: "정제됨", note: "postposed reporting clause" },
    refineOriginal: "The economy will recover by next year, analysts predict.",
    layer1: [
      { role: "S", ko: "주어", en: "The economy", trans: "경제" },
      { role: "V", ko: "동사", en: "will recover", trans: "회복될 것이다", expandable: true },
      { role: "A", ko: "부사어", en: "by next year", trans: "내년까지", expandable: true },
      { role: "A", ko: "부사어", en: ", analysts predict", trans: "분석가들에 따르면", expandable: true },
    ],
  },
  renaissance: {
    raw: "Hidden gems and forgotten stories from the Renaissance era.",
    ko: "르네상스 시대의 숨겨진 보석들과 잊혀진 이야기들.",
    refine: { kind: "정제됨", note: "동사 없는 헤드라인 단편 (등위 명사구)" },
    refineOriginal: "Hidden gems and forgotten stories from the Renaissance era.",
    layer1: [
      { role: "S", ko: "주어", en: "Hidden gems", trans: "숨겨진 보석들" },
      { role: "CONJ", ko: "접속", en: "and", trans: "그리고" },
      { role: "S", ko: "주어", en: "forgotten stories from the Renaissance era", trans: "르네상스 시대의 잊혀진 이야기들" },
    ],
  },
  microsoft: {
    raw: "Microsoft to launch new AI service next quarter.",
    ko: "마이크로소프트가 다음 분기에 새로운 AI 서비스를 출시할 예정입니다.",
    refine: { kind: "정제됨", note: "헤드라인 형식 (조동사 will 생략)" },
    refineOriginal: "Microsoft to launch new AI service next quarter.",
    layer1: [
      { role: "S", ko: "주어", en: "Microsoft", trans: "마이크로소프트" },
      { role: "V", ko: "동사", en: "to launch", trans: "출시할 예정" },
      { role: "O", ko: "목적어", en: "new AI service", trans: "새로운 AI 서비스" },
      { role: "A", ko: "부사어", en: "next quarter", trans: "다음 분기" },
    ],
  },
};

window.SAMPLES = SAMPLES;
