// gemini.js — LLM 프로바이더 연동, 프롬프트, 스키마
// 지원: Google AI Studio, Vertex AI, Groq (OpenAI 호환)

const DEBUG = false;
const log = DEBUG ? console.warn.bind(console, '[SVOCAt]') : () => {};

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const GOOGLE_MODELS = new Set(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro']);
const GROQ_MODELS = new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']);

// Groq(Llama) 전용 한국어 잠금 — Llama는 일본어/중국어로 빠지는 경향이 있어 강력한 제약 필요
const KOREAN_LOCK = `━━━ CRITICAL LANGUAGE RULE — READ FIRST ━━━
ALL Korean output MUST be in MODERN HANGUL (한글) ONLY.
The target audience is native Korean speakers — they cannot read Hanja or Japanese.

ZERO TOLERANCE for these character categories in Korean fields:
  ✗ Japanese kana (ひらがな, カタカナ)
  ✗ Japanese kanji / Korean hanja / Chinese characters (漢字 / 汉字)
  ✗ Any non-Hangul East Asian script

When a word is Sino-Korean (한자어), ALWAYS write its modern Hangul reading — NEVER the Hanja form, even when the concept feels "more precise" in Hanja.

Self-check protocol BEFORE returning JSON:
  1. Re-read every Korean field character by character.
  2. If ANY kanji/hanja/kana/simplified-chinese character is present, REPLACE it with its pure Hangul equivalent.
  3. Numbers (0-9), punctuation, and English words from the source text are OK — only Korean prose must be 100% Hangul.

Correct:
  ✓ "어느 회사가 제품을 리콜했다"
  ✓ "제품이 무균인지 증명할 수 없었다"

Incorrect (these will be REJECTED):
  ✗ "ある会社が製品をリコールした"   (Japanese)
  ✗ "某公司召回了产品"               (Chinese)
  ✗ "会社"                           (Hanja/Kanji)
  ✗ "潤滑劑 안약"                    (Hanja mixed in)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

function detectProvider(apiKey) {
  if (apiKey.startsWith('AIza')) return 'google';
  if (apiKey.startsWith('gsk_')) return 'groq';
  return 'vertex';
}

const PROVIDERS = {
  google: {
    buildUrl: (apiKey, model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    buildHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (prompt, userText, model) => ({
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    extractText: (json) => json?.candidates?.[0]?.content?.parts?.[0]?.text,
  },
  vertex: {
    buildUrl: (apiKey, model) =>
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${apiKey}`,
    buildHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (prompt, userText, model) => ({
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    extractText: (json) => json?.candidates?.[0]?.content?.parts?.[0]?.text,
  },
  groq: {
    buildUrl: () => `https://api.groq.com/openai/v1/chat/completions`,
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }),
    buildBody: (prompt, userText, model) => ({
      model,
      messages: [
        { role: 'system', content: KOREAN_LOCK + prompt },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
    extractText: (json) => json?.choices?.[0]?.message?.content,
  },
};

function resolveModel(provider, savedModel) {
  // 프로바이더와 모델이 호환되는지 체크 후 반환
  // (예: Groq 키에 Gemini 모델이 저장돼 있으면 Groq 기본 모델로 폴백)
  if (provider === 'groq') {
    return (savedModel && GROQ_MODELS.has(savedModel)) ? savedModel : GROQ_DEFAULT_MODEL;
  }
  // google, vertex
  return (savedModel && GOOGLE_MODELS.has(savedModel)) ? savedModel : DEFAULT_MODEL;
}

// ════════════════════════════════════════════════
// 공통 규칙: 영어 축약형 처리
// ════════════════════════════════════════════════
const CONTRACTION_RULE = `━━━ CONTRACTION HANDLING (apply whenever splitting S/V) ━━━
English contractions MUST be EXPANDED and SPLIT into their grammatical components.
The "text" field must contain the EXPANDED form, NEVER the contraction.

Expansion table:
  "'s"  → "is" (copula) or "has" (perfect) — choose by context
  "'m"  → "am"
  "'re" → "are"
  "'ve" → "have"
  "'ll" → "will"
  "'d"  → "would" (modal) or "had" (perfect) — choose by context
  "n't" → "not"  (role "A" when parent is verb-related)

Input "it's very unusual":
  ✓ [{S "it"}, {V "is"}, {C "very unusual"}]
  ✗ [{S "it's"}, {V "is"}, ...]       (duplication: 's and is overlap)
  ✗ [{S "it"}, {V "'s"}, ...]         (apostrophe form forbidden)

Input "he won't go":
  ✓ [{S "he"}, {MV "will"}, {A "not"}, {V "go"}]

Input "she's gone" (perfect aspect):
  ✓ [{S "she"}, {MV "has"}, {V "gone"}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;


// ════════════════════════════════════════════════
// PROMPT 1: 정제 + Layer 0 SVOCA 분석
// ════════════════════════════════════════════════
const ANALYZE_PROMPT = `You are an expert English grammar analyst. Process the given text in two steps.

━━━ STEP 1: NORMALIZATION ━━━
Inspect the text for issues:
• Grammar errors in the original → fix punctuation/spelling only
• Multiple sentences → analyze only the first complete one
• Truncated sentence (subject missing) → add [SUBJECT] marker, normalization_notes 기록

━━━ HEADLINE-STYLE INPUT (critical) ━━━
News headlines often omit auxiliary verbs (be / will / have) and articles.
Apply this rule ONLY when the sentence has NO inflected main verb and matches:
  • "X to V Y"           — implicit "will" (e.g., "Meta to cut staff")
  • "X V-ed Y" (no aux)  — implicit "be" passive (e.g., "Soldier arrested...")
  • "X V-ing Y" (no aux) — implicit "be" progressive (e.g., "Military developing plans...")

DO NOT apply this rule to:
  ✗ Sentences with complete verb phrases — even if news-style
  ✗ Sentences containing CONTRACTIONS (won't / it's / doesn't / I'd / they've / can't)
    Contractions are COMPLETE grammatical forms, NOT auxiliary omissions.
    Example: "George Russell hopes 2026 won't be his 'one and only shot'..."
       → is_complete: TRUE, normalization_notes: ""
       → won't = will + not (complete), NOT "will omitted"
  ✗ Long but grammatically complete sentences

UNIFIED POLICY: Do NOT insert artificial markers like [VERB]/[WILL]/[IS] into the
normalized text or chip text. Keep the headline text as-is.
  • Set is_complete: false
  • normalization_notes: "헤드라인 형식 (조동사 생략)" (or similar)
  • V chunk = whatever verb form is visible
    - "to V"      → V chunk = "to V"  (treat as infinitive verb head)
    - "V-ing Y"   → V chunk = "V-ing"
    - "V-ed by Y" → V chunk = "V-ed", with voice: "passive"
  • Apply consistently across the WHOLE sentence — never mix strategies.

Example — "Microsoft to offer voluntary retirement to thousands of employees":
  is_complete: false
  normalization_notes: "헤드라인 형식 (조동사 will 생략)"
  S = "Microsoft"
  V = "to offer"  (tense: future, voice: active)
  O = "voluntary retirement"
  A = "to thousands of employees"

Example — "US special forces soldier arrested after winning $400,000":
  is_complete: false
  normalization_notes: "헤드라인 형식 (be 동사 생략)"
  S = "US special forces soldier"
  V = "arrested"  (tense: past, voice: passive)
  A = "after winning $400,000"

Example — "Apple CEO Tim Cook to step down":
  is_complete: false
  V = "to step down"  (phrasal verb, kept whole)

Normalization rules:
• PRESERVE ALL WORDS — never delete original words
• PRESERVE ALL QUOTATION MARKS — " " ' ' " " carry grammatical meaning (direct speech, titles, etc.)
  NEVER remove quotes during normalization.
• PRESERVE CONTRACTIONS AS-IS in Step 1 — do NOT expand "it's" to "it is" here.
  Contraction expansion happens in Step 2, not Step 1.
  Correct Step 1: keep "it's" as "it's" in the normalized output.
• You may reorder words, fix spelling, or add [MISSING] markers for truly missing elements
• Punctuation changes: only fix clearly broken punctuation (missing period, doubled comma).
  Do NOT "clean up" meaningful punctuation like quotes, parentheses, em-dashes.
• If nothing to fix: set normalized = original, normalization_notes = ""

━━━ STEP 2: LAYER 0 — SVOCA ANALYSIS ━━━
Analyze the NORMALIZED sentence. Divide it into top-level chunks.

${CONTRACTION_RULE}

Allowed roles:
  "S"            — subject (entire noun phrase)
  "V"            — verb chunk (modal + main verb combined into ONE unit)
  "O"            — direct or indirect object
  "C"            — subject complement or object complement
  "A"            — any adverbial adjunct (time / place / manner / reason / condition)
  "conj"         — coordinating conjunction joining two main clauses (and/but/or/so)
  "interjection" — UNQUOTED standalone exclamations outside the main clause

━━━ QUOTED CONTENT RULE (critical) ━━━
Content inside quotes ("..." or '...') is ALWAYS a grammatical element of the main clause.
The role is determined by its function in the sentence, NOT by the words inside.
  ✓ He said "Wow!"           → "Wow!" is O (object of "said")
  ✓ He said "I love you."    → "I love you." is O (object of "said")
  ✓ "Help!" she cried.       → "Help!" is O (fronted)
  ✓ Her answer was "No."     → "No." is C (complement)

"interjection" is ONLY for UNQUOTED exclamations:
  ✓ Oh, I forgot my keys.    → "Oh" is interjection
  ✓ Wow, that's amazing!     → "Wow" is interjection
  ✗ He said "Wow!"           → do NOT label "Wow!" as interjection (it's O)

has_substructure for quoted content:
  • Single word/exclamation in quotes (e.g., "Wow!", "No.") → false
  • Complete sentence in quotes → true (will be drilled down as a sentence)

BUNDLING RULE (critical): Keep complex phrases/clauses as ONE chunk at this layer.
  ✓ "the woman who called you"  → single S chunk
  ✓ "must have been waiting"    → single V chunk
  ✓ "because he was tired"      → single A chunk
  ✗ Do NOT split into sub-parts at Layer 0

━━━ INTERNAL VERB-PHRASE ADVERBS (critical) ━━━
Adverbs that sit INSIDE a verb phrase (between auxiliary and main verb, or before
a modal) are PART OF the V chunk. NEVER extract them as separate A chunks.
  ✓ "was again closed"       → single V chunk "was again closed"
  ✓ "has already completed"  → single V chunk "has already completed"
  ✓ "would never agree"      → single V chunk "would never agree"
  ✓ "can hardly believe"     → single V chunk "can hardly believe"
  ✓ "must have been waiting" → single V chunk
  ✓ "can very well be waiting" → single V chunk
  ✗ V: "was closed", A: "again"   ← WRONG — "again" sits INSIDE the verb phrase
  ✗ V: "has completed", A: "already"   ← WRONG

These internal adverbs are split out ONLY when the user drills down into V (Layer 2+).

Coordination within a phrase: "dogs and cats" = one S chunk (not two separate S chunks).

━━━ RELATIVE CLAUSE BUNDLING (critical) ━━━
Relative clauses (who / which / that / where / when / why + clause) are ALWAYS
part of the noun phrase they modify, REGARDLESS OF LENGTH.
Never extract a relative clause as a separate A chunk.

  ✓ "Ukrainian infantry officer Oleksiy Mykhailov, who spent 343 days without leaving the front line"
    → ONE S chunk (the entire thing, including the relative clause)
    V and O follow in the main clause
  ✓ "the wolf, which went missing after escaping from its enclosure"
    → ONE O chunk (entire thing including relative clause)
  ✗ NEVER produce:
    S "Ukrainian infantry officer Oleksiy Mykhailov"
    A "who spent 343 days..."    ← wrong: this is a modifier of S, not a separate A
    V ...

The relative clause's length, comma presence, or complexity do NOT change this rule.
If the clause modifies a noun, it stays bundled with that noun's S/O/C chunk.

━━━ CAUSATIVE / PERCEPTION VERBS — SVOC (critical) ━━━
After make / let / have / help / see / hear / watch / feel + Object + bare-infinitive,
the bare-infinitive is C (object complement), NOT a second O.

Example — "make you rethink how you style your home":
  [{V "make"}, {O "you"}, {C "rethink how you style your home"}]
  ✗ NOT [{V "make"}, {O "you"}, {O "rethink..."}]   (two Os = wrong)

Example — "let her go":
  [{V "let"}, {O "her"}, {C "go"}]

Example — "see him cross the street":
  [{V "see"}, {O "him"}, {C "cross the street"}]

━━━ NORMALIZATION NOTES INTEGRITY (critical) ━━━
Any change between original and normalized — ANY whitespace, casing, contraction
expansion, marker insertion — MUST be recorded in normalization_notes.
If normalized === original, normalization_notes MUST be empty string "".
NEVER change the text without a corresponding note.
NEVER add a note when no change happened.
Wrong: original="won't", normalized="will not", notes="" — INVALID.
Wrong: original=normalized, notes="헤드라인 형식 (조동사 생략)" — INVALID (변경 없는데 메모)

━━━ is_complete: false — STRICT TRIGGERS ━━━
Set is_complete: false ONLY for STRUCTURAL incompleteness:
  ✓ No main verb at all (e.g., "Jim Carrey, Leonardo DiCaprio and how...")
  ✓ Subordinate clause without main clause (e.g., "Because she was tired.")
  ✓ Sentence fragment lacking subject (e.g., "Said yesterday.")
  ✓ Genuine headline-style auxiliary omission per HEADLINE-STYLE INPUT rule above

DO NOT set is_complete: false for:
  ✗ Sentences with contractions (won't / it's / doesn't / I'd / they've / can't)
  ✗ Sentences with article omissions but complete verbs ("Police detain man")
  ✗ Long but grammatically complete sentences
  ✗ Sentences with embedded that-clauses (even with implicit "that")
  ✗ Sentences with idiomatic structures

━━━ VERBLESS HEADLINE FRAGMENT (critical) ━━━
TRIGGER (apply when ALL conditions match):
  • The input is a single sentence ending in a period/exclamation/question mark
  • There is NO inflected main verb anywhere at the top level
  • What's present is just noun phrase(s), possibly connected by "and"/"or" or comma
  • Examples that should trigger:
      "Jim Carrey, Leonardo DiCaprio and how the double standard of male aging may be over."
      "Hidden gems and forgotten stories from the Renaissance era."
      "Modern art, classical music and digital streaming."
      "A defining challenge of our generation."

Required output when trigger fires:
  • is_complete: false
  • normalization_notes: "동사 없는 헤드라인 단편" (or similar concise note)
  • Layer 0 grammar: do NOT bundle the entire fragment as a single S chunk.
    Decompose into the visible noun phrase pieces (S chunks) connected by conj
    when applicable. Or use a single S only if the fragment is one cohesive NP.

NEVER:
  ✗ Treat verbless input as a complete sentence (is_complete: true)
  ✗ Skip the normalization_notes when this trigger fires
  ✗ Force-fit into S/V/O when there's no V

Example — "Hidden gems and forgotten stories from the Renaissance era.":
  is_complete: false
  normalization_notes: "동사 없는 헤드라인 단편 (등위 명사구)"
  grammar:
    [{S "Hidden gems",                    korean: "숨겨진 보석들"},
     {conj "and",                         korean: "그리고"},
     {S "forgotten stories from the Renaissance era", korean: "르네상스 시대의 잊혀진 이야기들"}]

━━━ COLON-SEPARATED HEADLINE (critical) ━━━
Pattern: "A: B" where A is a short topic/category label and B is the main content.
Common in news headlines, magazine articles, and titled pieces.

Examples:
  "Owners vs. renters: The political battle over America's single-family homes."
  "Comeback of the century: K-pop phenomenon BTS returns with first concert in years."
  "Inside Asia's Fort Knox: Gold bars, fine art — and a 66-million-year-old Triceratops."
  "Breaking: Federal judge blocks merger."

Strategy at Layer 0:
  • Pre-colon part = ONE chunk with role "A", korean "부사어 (주제)"
    The colon itself stays attached to the pre-colon text or is dropped.
  • Post-colon part = analyzed normally with SVOCA
  • If post-colon has no main verb → is_complete: false + nn note
  • If post-colon is a complete clause → is_complete: true
  • normalization_notes: "콜론 헤드라인 (주제: 본문 구조)" (or similar) when this rule fires

NEVER bundle the entire "A: B" as a single S/O chunk.
NEVER label the colon as conj.

Example — "Owners vs. renters: The political battle over America's single-family homes.":
  is_complete: false
  normalization_notes: "콜론 헤드라인 (주제: 본문 구조), 본문 동사 없음"
  Layer 0:
    [A: "Owners vs. renters", korean: "소유자 vs 임차인 (주제)"]
    [S: "The political battle over America's single-family homes"]
    (no V/O — post-colon is a noun phrase only)

Example — "Comeback of the century: K-pop phenomenon BTS returns with first concert in years.":
  is_complete: true
  normalization_notes: "콜론 헤드라인 (주제: 본문 구조)"
  Layer 0:
    [A: "Comeback of the century", korean: "세기의 컴백 (주제)"]
    [S: "K-pop phenomenon BTS"]
    [V: "returns"]
    [A: "with first concert in years"]

━━━ POSTPOSED REPORTING CLAUSE (critical) ━━━
Pattern: "[main statement], [Reporter] [reporting-verb]."
where reporting-verb = says / said / notes / finds / shows / reports / reveals /
                        claims / announces / argues / believes / thinks / adds / etc.

Examples (very common in news):
  "Rock discovery contains clearest sign of ancient life on Mars, NASA says."
  "Site contains 124 shipwrecks, archaeologists find."
  "Jim Furyk is returning as US Ryder Cup captain for 2027, AP sources say."
  "Giant, 60-foot octopuses were apex predators, fossil discovery shows."

This is NOT two coordinated clauses. The comma is NOT a conjunction.
The postposed reporter clause is a PARENTHETICAL ATTRIBUTION (출처 표시).

Layer 0 strategy:
  • Analyze the MAIN statement normally (S V O C A)
  • Treat the postposed ", X V" as ONE chunk:
      role: "A"
      korean: 발언자 한국어 + "에 따르면" (예: "NASA에 따르면", "AP 통신에 따르면")
      has_substructure: true   (drilldown shows internal S + V)
  • NEVER label the comma as conj
  • NEVER split the reporter into a separate top-level S + V

Example — "Rock discovery contains clearest sign of ancient life on Mars, NASA says.":
  [
    {S: "Rock discovery"},
    {V: "contains"},
    {O: "clearest sign of ancient life on Mars"},
    {A: ", NASA says", korean: "NASA에 따르면", has_substructure: true}
  ]

Example — "Site contains 124 shipwrecks, archaeologists find.":
  [
    {S: "Site"},
    {V: "contains"},
    {O: "124 shipwrecks"},
    {A: ", archaeologists find", korean: "고고학자들에 따르면", has_substructure: true}
  ]

━━━ DRILLDOWN OF POSTPOSED "출처" A CHUNK ━━━
When the user drills into a postposed reporting chunk like ", NASA says" or
", recent studies find", apply CLAUSE decomposition (NOT simple adverb labeling):
  • The leading comma → ignore OR set role "conj" with korean "(쉼표)"
  • The reporter noun phrase → role "S" (KEEP MULTI-WORD NOUN PHRASES TOGETHER)
  • The reporting verb (says / find / show / predict) → role "V" with tense/voice

━━━ MULTI-WORD REPORTER (critical) ━━━
The reporter portion can be MULTI-WORD: "recent studies", "AP sources",
"government officials", "industry experts", "the journal", etc.
ALL words of that noun phrase form ONE S chunk together.
NEVER split modifier+head into separate ADV items.

  ✗ ADV "recent" + ADV "studies" + ADV "find"            ← WRONG (split into 3)
  ✗ ADV "AP" + ADV "sources" + V "say"                   ← WRONG
  ✓ S "recent studies" + V "find"                         ← CORRECT (single S)
  ✓ S "AP sources"     + V "say"                          ← CORRECT
  ✓ S "government officials" + V "report"                 ← CORRECT

NEVER label the reporter as "ADV" / "adv". NEVER label the verb as "ADV".
NEVER make the entire content a flat list of ADV items.

Examples — drilling into postposed reporter A chunks:

  A ", NASA says":
    ✓ [{conj ",", korean: "(쉼표)"}, {S "NASA", korean: "NASA"}, {V "says", korean: "말한다", tense: "present", voice: "active"}]
    ✗ [{ADV ","}, {ADV "NASA"}, {ADV "says"}]   ← WRONG

  A ", recent studies find":
    ✓ [{conj ",", korean: "(쉼표)"}, {S "recent studies", korean: "최근 연구들"}, {V "find", korean: "발견하다", tense: "present", voice: "active"}]
    ✗ [{ADV ","}, {ADV "recent"}, {ADV "studies"}, {ADV "find"}]   ← WRONG (4 ADVs)

  A ", AP sources say":
    ✓ [{conj ",", korean: "(쉼표)"}, {S "AP sources", korean: "AP 통신 소식통"}, {V "say", korean: "전한다", tense: "present", voice: "active"}]

━━━ SPEECH/COGNITION VERB + that-COMPLEMENT (critical) ━━━
When the main verb is a speech/cognition verb (say, tell, announce, state, believe,
think, know, hope, argue, suggest, etc.), its content complement is ALWAYS a SINGLE
O chunk at Layer 0 — no matter how long or complex the complement is.

  ✓ He said that the project succeeded.
    → [S: He] [V: said] [O: that the project succeeded]
  ✓ She believes the earth is round.
    → [S: She] [V: believes] [O: the earth is round]   (implicit "that")
  ✓ Sarandos said that while "X," Hastings is "Y."
    → [S: Sarandos] [V: said]
      [O: that while "X," Hastings is "Y."]   ← entire that-clause is ONE O chunk
    NOT: separate chunks for "while X," / "Hastings" / "is" / "Y"
    The internal structure (while-clause, embedded quotes, sub-clauses) is ignored
    at Layer 0 and revealed only on drilldown.

News-article style: journalists often stitch direct quotes with prose across a
that-complement (e.g., 'said that "A," X is "B."'). The ENTIRE span from "that"
(or its implicit position) through the end of the complement is ONE O chunk.

When a reporting verb like "said" has multiple that-complements joined by "and/but":
  ✓ He said [that X] and [that Y] → two O chunks (coordinate objects) joined by conj

Set has_substructure: true when a chunk CAN be meaningfully drilled into:
  S / O / C → true if it contains a modifier (relative clause, participial phrase, appositive, etc.)
  V         → true if it contains a modal or auxiliary (is, has, will, can, have been, etc.)
  A         → true if it is a prepositional phrase OR a subordinate adverb clause
  A         → false if it is a single simple adverb (quickly, always, very well, etc.)

━━━ KOREAN FIELD FORMAT (critical) ━━━
The "korean" field is a NATURAL KOREAN TRANSLATION of the chunk's English text.
It helps learners understand each piece's meaning without leaving English.

Requirements:
  ✓ Pure Hangul (한글) ONLY. NO Hanja/Kanji/Kana/Chinese characters.
  ✓ Concise — translate the chunk's meaning, not its grammatical role.
  ✓ Use natural Korean word order (the role is shown by the role field separately).
  ✓ For function words / very short chunks, give the most natural Korean equivalent;
    if no clean translation exists, give a brief role hint instead.

Examples:
  S "A federal judge"          → korean: "연방 판사"
  V "is raising"                → korean: "제기하고 있다"
  O "concerns about whether..." → korean: "~인지에 관한 우려"
  A "100 million years ago"     → korean: "1억 년 전"
  C "no ordinary founder"       → korean: "평범한 창립자가 아닌"
  conj "but"                    → korean: "하지만"
  conj ","                      → korean: "(쉼표)"  (function word fallback)
  interjection "Oh"             → korean: "오"

Forbidden patterns:
  ✗ "주어"                       (raw role label — role field already says this)
  ✗ "주어: 연방 판사"            (label + meaning mix)
  ✗ "主語" / "判事"             (Japanese / Hanja)
  ✗ overly long retelling that duplicates whole-sentence translation

━━━ OUTPUT — return ONLY valid JSON ━━━
{
  "normalized": "정제된 문장 (원문 단어 보존, 구두점/어순만 조정 가능)",
  "normalization_notes": "변경 이유 (변경 없으면 빈 문자열 \\"\\")",
  "is_complete": true,
  "translation": "자연스러운 한국어 번역",
  "grammar": [
    {
      "role": "S|V|O|C|A|conj|interjection",
      "text": "영어 원문 (띄어쓰기 포함, 원문 그대로)",
      "korean": "역할 라벨만 (예: 주어, 동사, 부사어 (시간))",
      "has_substructure": false
    }
  ],
  "words": [
    {
      "word": "단어 원형",
      "pronunciation": "발음기호 또는 발음 표기",
      "pos": "품사 (noun / verb / adjective / adverb / preposition / etc.)",
      "definition": "한국어 뜻"
    }
  ]
}

Coverage rule: grammar[].text fields must together cover every word in normalized exactly once.
EXCEPTION — contraction expansion: when CONTRACTION HANDLING splits a contraction,
the expanded components count as covering the original contraction. e.g., "it's" in the
normalized text is fully covered by [{text: "it"}, {text: "is"}] even though "is" is
not a literal substring.

Words list: include content words only (omit articles and common pronouns like the/a/I/he/she/it/they).`;


// ════════════════════════════════════════════════
// PROMPT 2: Layer N 드릴다운 분석
// ════════════════════════════════════════════════
const DRILLDOWN_PROMPT = `You are an expert English grammar analyst. Drill down into a single English chunk.
The chunk's parent role (S / V / O / C / A) is provided. Apply the matching rule below.

IMPORTANT: This text is a FRAGMENT extracted from a larger sentence, NOT a complete sentence.
Do NOT re-analyze the whole thing as a sentence. Break it into its INTERNAL parts only.

Output a FLAT grammar array — do NOT nest objects inside each other.
Output items in the SAME ORDER as they appear in the original text (left to right).

${CONTRACTION_RULE}

━━━ RULE A: Parent = S, O, or C (noun chunk) ━━━
Split into: [head] + [modifier(s)] ONLY.
CRITICAL: Do NOT include the parent chunk itself as an output item.
Output ONLY the decomposed parts.

PRECONDITION: RULE A applies when the chunk is a NOUN PHRASE.
If the chunk is a VERBAL PHRASE (causative C with bare-infinitive,
infinitive phrase, participial phrase) → use RULE C Case 4 instead
(lowercase v / o / c / a roles, with the verb form as the first "v" item).

Example — parent=C, chunk is "run ten miles every morning" (causative bare-inf):
  Apply Case 4 (NOT RULE A):
    [{v "run",         korean: "달리다"},
     {o "ten miles",   korean: "10마일을"},
     {a "every morning", korean: "매일 아침"}]
  ✗ NOT [{modifier "run"}, {modifier "ten miles"}, {modifier "every morning"}]
    (this would have no HEAD and treats verb phrase as noun phrase — WRONG)

  "head"     — the core noun, pronoun, or adjective (for C)
                korean field: describe WHAT the head IS (e.g., "핵심명사", "핵심어", "중심 어휘").
                Do NOT use "주어" / "목적어" / "보어" — those are the PARENT's role, not the head's.
  "modifier" — everything that modifies the head (one flat item per modifier)

For each modifier, set has_substructure: true and specify what kind it is in the "korean" field:
  • Relative clause  (who/which/that…) → has_substructure: true
  • Participial phrase (running / broken…) → has_substructure: true
  • Infinitive phrase (to do…) → has_substructure: true
  • Simple adjective or determiner → has_substructure: false

Example — parent=S, chunk is "Ukrainian infantry officer Oleksiy Mykhailov":
  [
    {modifier "Ukrainian",         korean: "우크라이나의"},
    {modifier "infantry",          korean: "보병의"},
    {head "officer",               korean: "장교"},
    {modifier "Oleksiy Mykhailov", korean: "올렉시 미하일로프"}
  ]
  NEVER output {S "Ukrainian infantry officer Oleksiy Mykhailov"} — that is the PARENT.

━━━ HEAD vs MODIFIER ROLE SELECTION (critical) ━━━
For a noun-chunk drilldown, the central noun(s) should be HEAD; everything else MODIFIER.

Single-head case (most common):
  • Exactly ONE chunk → role: "head"
  • All others → role: "modifier"

Coordinated noun phrase ("X and Y", "X, Y, and Z", "X or Y"):
  • BOTH/ALL coordinated nouns → role: "head" (multiple heads allowed in this case)
  • The connecting word (and/or) → role: "conj"
  • Modifiers of either head → role: "modifier"

Example — single-head "the brilliant young architect Frank Lloyd Wright":
  [{modifier "The"},
   {modifier "brilliant"},
   {modifier "young"},
   {head "architect"},
   {modifier "Frank Lloyd Wright"}]

Example — coordinated "Hidden gems and forgotten stories":
  [{modifier "Hidden",     korean: "숨겨진"},
   {head     "gems",       korean: "보석들"},
   {conj     "and",        korean: "그리고"},
   {modifier "forgotten",  korean: "잊혀진"},
   {head     "stories",    korean: "이야기들"}]

NEVER:
  ✗ Label the head as modifier or vice versa
  ✗ Output ALL items as modifier with no head
  ✗ Output a single chunk that equals the parent (the parent itself is not an item)

━━━ RULE B: Parent = V (verb chunk) ━━━
Split into modal/auxiliary + main verb:
  "MV" — modal or auxiliary (can, will, have, be, would have, etc.)
  "V"  — main verb (base form, -ing, or past participle)

━━━ AUXILIARY DETECTION (critical) ━━━
ALWAYS split these auxiliaries into MV:
  • Modals: can/could, will/would, shall/should, may/might, must, ought to
  • Be-auxiliaries (progressive/passive): am/is/are/was/were/being/been
  • Have-auxiliaries (perfect): have/has/had/having
  • Do-auxiliaries (emphasis/negation/question): do/does/did
If the chunk has ANY of these + a main verb, ALWAYS produce MV + V.
Never return a single V item when an auxiliary is present.

━━━ PASSIVE VOICE DETECTION (highest priority) ━━━
If the chunk matches "be-form + past-participle" (e.g., was closed, is written,
has been recalled, will be done), you MUST split it:
  • be-form → MV
  • past-participle → V with voice: "passive"
Never return "was closed" / "is written" / etc. as a single V item.

━━━ INTERNAL ADVERBS (between MV and V) ━━━
If an adverb (again / already / never / hardly / always / often / also / very /
properly etc.) sits between the MV and main V, split it as its own A item.
Output order: MV … [A …] V
Examples:
  "was again closed":
    [{MV "was", tense:null, voice:null},
     {A "again", korean: "다시"},
     {V "closed", tense:"past", voice:"passive"}]
  "has already completed":
    [{MV "has", tense:null, voice:null},
     {A "already", korean: "이미"},
     {V "completed", tense:"present-perfect", voice:"active"}]
  "must have been carefully examined":
    [{MV "must have been", tense:null, voice:null},
     {A "carefully", korean: "신중히"},
     {V "examined", tense:"present-perfect", voice:"passive"}]

━━━ TENSE / VOICE ASSIGNMENT (critical) ━━━
tense and voice go ONLY on the V item.
MV items MUST have tense: null and voice: null. Never duplicate tense between MV and V.

Tense decision table (what to put on V):
  can / shall / may / must + V          →  tense = "present"
  will + V                              →  tense = "future"
  could / would / should / might + V    →  tense = "past"
  have / has + past-participle          →  tense = "present-perfect"
  had + past-participle                 →  tense = "past-perfect"
  will have + past-participle           →  tense = "future-perfect"
  am / is / are + V-ing                 →  tense = "present-continuous"
  was / were + V-ing                    →  tense = "past-continuous"
  will be + V-ing                       →  tense = "future-continuous"

Voice + passive tense table:
  am/is/are + past-participle       →  tense = "present",           voice = "passive"
  was/were + past-participle        →  tense = "past",              voice = "passive"
  will be + past-participle         →  tense = "future",            voice = "passive"
  have/has been + past-participle   →  tense = "present-perfect",   voice = "passive"
  had been + past-participle        →  tense = "past-perfect",      voice = "passive"
  will have been + past-participle  →  tense = "future-perfect",    voice = "passive"

  "active" otherwise (non-"be" auxiliary, or no auxiliary at all)

Allowed tense values:
  present / past / future / present-perfect / past-perfect / future-perfect /
  present-continuous / past-continuous / future-continuous /
  present-perfect-continuous / past-perfect-continuous / future-perfect-continuous

Example — "could prove":
  [{MV "could", tense:null, voice:null}, {V "prove", tense:"past", voice:"active"}]
  ✗ NOT: {V "prove", tense:"present"}   (could is past-form modal)
  ✗ NOT: {MV "could", tense:"past"}      (tense goes on V only)

Example — "has been recalled":
  [{MV "has been", tense:null, voice:null}, {V "recalled", tense:"present-perfect", voice:"passive"}]

Example — "was eating":
  [{MV "was", tense:null, voice:null}, {V "eating", tense:"past-continuous", voice:"active"}]

If there is no modal/auxiliary at all (e.g., simple "ran", "eats"),
return a single "V" item with tense and voice directly.

━━━ RULE C: Parent = A (adverb chunk) ━━━

CASE SELECTION — look at the FIRST word(s) of the chunk:
  • LEADING COMMA "," + noun phrase + reporting verb → Case 5 (POSTPOSED REPORTING)
  • Simple adverb (quickly, always, soon)            → Case 1
  • Preposition (in, on, at, from, to, with, of...)  → Case 2
  • Subordinating conjunction (because, while, if, although, when, as, until...)
                                                     → Case 3
  • Present/past participle (-ing or -ed form)       → Case 4 (participial)
  • "to" + base verb (to do, to improve)             → Case 4 (infinitive)

Case 1 — Simple adverb: single item role "adv", has_substructure: false

Case 2 — Prepositional phrase:
  "prep" — the preposition
  "O"    — the noun object (follow noun-chunk rules for has_substructure)
  Example — "from the long journey":
    [{prep "from"}, {O "the long journey"}]

Case 3 — Adverb clause (subordinating conjunction + clause):
  Output: ONE "conj" item + FULL SVOCA decomposition of the clause body.
  CRITICAL: NEVER leave the clause body as a single chunk.
  If the body contains quoted content, treat it as normal clause content for SVOCA
  — the quotes are just punctuation, not a semantic boundary.
  Example — "because he was tired":
    [{conj "because"}, {S "he"}, {V "was tired"}]
  Example — 'while "it was raining"':
    [{conj "while"}, {S "it"}, {V "was raining"}]

  ━━━ NOUN-CLAUSE vs ADVERB-CLAUSE DISTINCTION ━━━
  Inside a decomposed adverb clause, embedded noun clauses keep their grammatical
  function as O or C (of the inner verb) — NOT A.
  Triggers for noun-clause role (O or C, not A):
    • "whether / if + clause" as object of verbs like prove/ask/wonder/know/decide
    • "that + clause" as object (he proved that X / she said that X)
    • "what / who / where / when / why / how + clause" as object (I know what X)
  Example — "because he proved whether the products were sterile":
    [{conj "because"},
     {S "he"},
     {V "proved"},
     {O "whether the products were sterile", korean: "제품이 무균인지"}]
    ✗ NOT: {A "whether the products were sterile"} (wrong — it's O of "proved")

Case 4 — Infinitive/participial adverb phrase:
  The FIRST item MUST be the participle/infinitive itself (role "v", lowercase).
  NEVER skip it, even if a preposition follows right after.
  Subsequent items: use lowercase roles "o" "c" "a" (no explicit subject).

  Example — "Exhausted from the long journey":
    ✓ [{v "Exhausted"}, {prep "from"}, {o "the long journey"}]
    ✗ [{prep "from"}, {O "the long journey"}]   ← "Exhausted" missing — FORBIDDEN
  Example — "Walking down the street":
    ✓ [{v "Walking"}, {a "down the street"}]
  Example — "to improve the economy":
    ✓ [{v "to improve"}, {o "the economy"}]
  Example — "Broken by the storm":
    ✓ [{v "Broken"}, {prep "by"}, {o "the storm"}]

Case 5 — POSTPOSED REPORTING CLAUSE (",  X  V" pattern):
  When the parent A chunk starts with a comma followed by a noun phrase + reporting verb
  (e.g., ", NASA says", ", recent studies find", ", AP sources report"):
  Output:
    • Leading comma → role "conj" with korean "(쉼표)"
    • Reporter noun phrase → role "S" (KEEP MULTI-WORD NPs TOGETHER as ONE chunk)
    • Reporting verb → role "V" with tense / voice / korean translation

  CRITICAL: NEVER label items inside Case 5 as ADV.
  CRITICAL: NEVER split a multi-word reporter into separate words.
  The reporter "recent studies" / "AP sources" / "government officials" is ONE S chunk.

  Example — ", NASA says":
    ✓ [{conj ",", korean: "(쉼표)"},
       {S "NASA", korean: "NASA"},
       {V "says", korean: "말한다", tense: "present", voice: "active"}]
    ✗ [{ADV ","}, {ADV "NASA"}, {ADV "says"}]                       ← WRONG (all ADV)

  Example — ", recent studies find":
    ✓ [{conj ",", korean: "(쉼표)"},
       {S "recent studies", korean: "최근 연구들"},
       {V "find", korean: "발견하다", tense: "present", voice: "active"}]
    ✗ [{ADV ","}, {ADV "recent"}, {ADV "studies"}, {ADV "find"}]    ← WRONG (split + ADV)
    ✗ [{ADV ","}, {ADV "recent studies"}, {ADV "find"}]             ← WRONG (still ADV)

  Example — ", AP sources say":
    ✓ [{conj ",", korean: "(쉼표)"},
       {S "AP sources", korean: "AP 통신 소식통"},
       {V "say", korean: "전한다", tense: "present", voice: "active"}]

━━━ RULE D: Parent = S/O/C and chunk is a CLAUSE ━━━
TRIGGER: parent role is S, O, or C AND the chunk contains a subject + finite verb
(i.e., it is a nominal clause, not a noun phrase).

This overrides RULE A (noun chunk) for that specific parent.
It does NOT apply when parent is A — use RULE C Case 3 for adverb clauses.
It does NOT apply when parent is V — use RULE B.

Commonly occurs with:
  • Direct quotations (e.g., "he said 'X is Y'")
  • That-clauses as O (e.g., "that the earth is round")
  • Relative clauses that are themselves full sentences

OUTPUT: Fresh SVOCA breakdown at clause level.
  Allowed roles: "S" "V" "O" "C" "A" "conj"
  Do NOT use phrase-level roles ("head", "modifier", "MV").
  Strip surrounding quotes mentally, but keep the original text in "text" field.

━━━ CRITICAL: conj "that" ONLY if literally present ━━━
Output a conj "that" item ONLY when the word "that" appears in the input chunk.
If the chunk is a that-complement where "that" was omitted (implicit that-clause),
do NOT fabricate a conj item.

Example — parent=O, chunk is "that he was late" (explicit "that"):
  [
    {conj "that", korean: "~라는"},
    {S "he",      korean: "그가"},
    {V "was",     korean: "이었다", tense: "past", voice: "active"},
    {C "late",    korean: "늦은"}
  ]

Example — parent=O, chunk is "he was late" (implicit, no "that" in chunk):
  [
    {S "he",      korean: "그가"},
    {V "was",     korean: "이었다", tense: "past", voice: "active"},
    {C "late",    korean: "늦은"}
  ]
  NEVER add {conj "that"} here — the word "that" is not in the chunk.

━━━ CRITICAL: Relative Clauses ━━━
For relative clauses (chunk begins with who/which/that/where/when/why as
a relative pronoun followed by a clause), the relative pronoun serves as
S, O, or A of the relative clause itself — NOT as a conjunction.
Output it ONLY ONCE, with its clause role.

Example — parent=S (modifier drilldown), chunk is "who spent 343 days on the front line":
  [
    {S "who",       korean: "(누구)"},
    {V "spent",     korean: "보냈다", tense: "past", voice: "active"},
    {O "343 days",  korean: "343일을"},
    {A "on the front line", korean: "전선에서"}
  ]
  NEVER output both {conj "who"} and {S "who"} — ONE item only.

Example — chunk is "which she bought yesterday":
  [
    {O "which",     korean: "(무엇을)"},
    {S "she",       korean: "그녀가"},
    {V "bought",    korean: "샀다", tense: "past", voice: "active"},
    {A "yesterday", korean: "어제"}
  ]

Example — chunk is '"it\'s very unusual for a founder to step away"' (direct quotation):
  [
    {S "it",                          korean: "그것은"},
    {V "is",                          korean: "이다", tense: "present", voice: "active"},
    {C "very unusual",                korean: "매우 이례적인"},
    {A "for a founder to step away",  korean: "창립자가 물러나는 것은"}
  ]

━━━ KOREAN FIELD FORMAT (critical) ━━━
"korean" 은 청크의 영어 텍스트를 자연스럽게 번역한 한국어.
역할은 role 필드에서 보여주므로 여기에는 의미만 적음.

요구사항:
  ✓ 순수 한글만 (한자/가나/한글 외 문자 금지)
  ✓ 자연스러운 한국어 어순
  ✓ 짧고 직관적 — 청크의 뜻만 전달
  ✓ 함수어(전치사·관계대명사 등)는 자연스러운 한국어 대응어 또는 간단한 힌트

예시:
  head "officer"                            → "장교"
  modifier "Ukrainian"                      → "우크라이나의"
  modifier "who spent 343 days..."          → "343일을 보낸"
  MV "could"                                → "할 수 있었다"
  V "go missing"                            → "사라지다"
  prep "about"                              → "~에 관한"
  conj "because"                            → "왜냐하면"
  conj "that"                               → "~라는"
  adv "always"                              → "항상"
  v "Walking"                               → "걸으며"

금지:
  ✗ "주어" / "수식어" / "전치사"            (raw 역할 라벨 — role 필드와 중복)
  ✗ "관계대명사 (주어)"                     (역할 메타정보)
  ✗ 한자(主語), 가나
  ✗ 전체 문장 다시 번역하기

━━━ OUTPUT — return ONLY valid JSON ━━━
{
  "grammar": [
    {
      "role": "head|modifier|S|V|O|C|A|MV|prep|conj|v|o|c|a|adv",
      "text": "영어 원문 텍스트",
      "korean": "역할 라벨만 (예: 주어, 핵심명사, 부사어 (시간))",
      "has_substructure": false,
      "tense": null,
      "voice": null
    }
  ],
  "translation": "이 청크 전체의 한국어 번역 또는 설명"
}

Coverage rule: grammar[].text must together cover every word of the input chunk exactly once.
EXCEPTION — contraction expansion: expanded components (e.g., "it" + "is" from "it's")
count as covering the original contraction, even though the expansion is not a literal substring.`;


// ════════════════════════════════════════════════
// PROMPT 3: 단어 사전 모드
// ════════════════════════════════════════════════
const WORD_PROMPT = `You are an English-Korean dictionary. Return ONLY valid JSON.
Given a single English word, return:
{
  "word": "원형 (lemma)",
  "pronunciation": "IPA 발음기호",
  "pos": "품사 (noun / verb / adjective / adverb / etc.)",
  "definition": "한국어 뜻 (간결하게)"
}`;


// ════════════════════════════════════════════════
// API 호출
// ════════════════════════════════════════════════
class GeminiError extends Error {
  constructor(message, errorType = 'api_error') {
    super(message);
    this.errorType = errorType;
    this.name = 'GeminiError';
  }
}

async function getSettings() {
  const { apiKey, model } = await chrome.storage.local.get(['apiKey', 'model']);
  if (!apiKey) throw new GeminiError('API 키가 설정되지 않았습니다.', 'auth');
  const provider = detectProvider(apiKey);
  return { apiKey, model: resolveModel(provider, model), provider };
}

// 429 응답 본문을 파싱해 한국어 상세 메시지 생성
// Groq 형식: "Rate limit reached ... on tokens per day (TPD): Limit 100000, Used ... Please try again in 45m12s. Visit..."
// Gemini 형식: "Resource has been exhausted (e.g. check quota)."
function buildRateLimitMessage(detail) {
  if (!detail) return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';

  const retryMatch = detail.match(/try again in\s+([\dhms\s.]+?)(?:[.\s]|$)/i);
  const retryTime = retryMatch ? retryMatch[1].trim() : null;

  const isDaily   = /per day|daily|\bTPD\b|\bRPD\b/i.test(detail);
  const isMinute  = /per minute|\bTPM\b|\bRPM\b/i.test(detail);
  const isToken   = /\btokens?\b/i.test(detail);
  const isRequest = /\brequests?\b/i.test(detail);

  // Gemini류의 간단한 "exhausted" 메시지
  if (/exhausted|quota/i.test(detail) && !isDaily && !isMinute) {
    return '요청 할당량이 소진되었습니다. 옵션에서 다른 모델을 선택하거나 잠시 후 재시도해주세요.';
  }

  let msg;
  if (isDaily) {
    msg = isToken ? '일일 토큰 한도 소진' : (isRequest ? '일일 요청 한도 소진' : '일일 한도 소진');
  } else if (isMinute) {
    msg = isToken ? '분당 토큰 한도 초과' : (isRequest ? '분당 요청 한도 초과' : '분당 한도 초과');
  } else {
    msg = '요청 한도 초과';
  }

  if (retryTime) {
    msg += ` (약 ${retryTime} 후 재시도 가능)`;
  } else if (isDaily) {
    msg += ' — 내일 다시 시도해주세요';
  } else {
    msg += ' — 잠시 후 다시 시도해주세요';
  }
  return msg + '.';
}

const MAX_RETRY_WAIT_MS = 10000; // 재시도 대기 상한선 (10초)

async function fetchWithRetry(url, options, retries = 2, delay = 1000) {
  const resp = await fetch(url, options);

  // 503: 서버 과부하 — 짧게 재시도
  if (resp.status === 503 && retries > 0) {
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }

  // 429: rate limit — Retry-After가 너무 길면 재시도 포기
  if (resp.status === 429 && retries > 0) {
    const retryAfterRaw = parseInt(resp.headers.get('Retry-After') || '0', 10);
    const retryAfterMs = (isNaN(retryAfterRaw) ? 0 : retryAfterRaw) * 1000;
    // 10초 넘게 기다려야 하면 바로 실패 반환 (사용자가 무한 로딩 체감하지 않도록)
    if (retryAfterMs > MAX_RETRY_WAIT_MS) {
      return resp;
    }
    const wait = Math.min(Math.max(retryAfterMs, delay), MAX_RETRY_WAIT_MS);
    await new Promise(r => setTimeout(r, wait));
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }

  return resp;
}

async function callGemini(prompt, userText, signal) {
  if (!navigator.onLine) {
    throw new GeminiError('인터넷 연결이 없습니다. 네트워크를 확인해주세요.', 'network');
  }
  const { apiKey, model, provider } = await getSettings();
  const p = PROVIDERS[provider];

  const resp = await fetchWithRetry(p.buildUrl(apiKey, model), {
    method: 'POST',
    headers: p.buildHeaders(apiKey),
    body: JSON.stringify(p.buildBody(prompt, userText, model)),
    signal,
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => null);
    const detail = errBody?.error?.message || errBody?.message || '';
    if (resp.status === 401 || resp.status === 403)
      throw new GeminiError('API 키가 유효하지 않습니다. 옵션에서 확인해주세요.', 'auth');
    if (resp.status === 429)
      throw new GeminiError(buildRateLimitMessage(detail), 'rate_limit');
    if (resp.status === 503)
      throw new GeminiError('서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.', 'api_error');
    throw new GeminiError(`API 오류 (${resp.status}): ${detail || '알 수 없는 오류'}`, 'api_error');
  }

  const json = await resp.json();
  const raw = p.extractText(json);
  if (!raw) throw new GeminiError('API 응답이 비어있습니다.', 'api_error');

  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) return JSON.parse(m[1]);
    throw new GeminiError('응답 파싱에 실패했습니다.', 'parse_error');
  }
}


// ════════════════════════════════════════════════
// 후처리
// ════════════════════════════════════════════════
const LAYER0_ROLES = new Set(['S','V','O','C','A','conj','interjection']);
const LAYER1_ROLES = new Set([
  'S','V','O','C','A','MV','prep','conj',
  'head','modifier','v','o','c','a','adv',
]);

function normalizeGrammar(grammar, validRoles, originalText) {
  if (!Array.isArray(grammar)) return [];
  const items = grammar
    .filter(item => item.text)
    .map(item => {
      const role = validRoles.has(item.role) ? item.role : 'A';
      if (!validRoles.has(item.role)) {
        log('Unknown role replaced:', item.role, '→ A');
      }
      return {
        role,
        text: String(item.text || '').trim(),
        korean: String(item.korean || '').trim(),
        has_substructure: !!item.has_substructure,
        tense: (item.tense || '').toLowerCase() || null,
        voice: (item.voice || '').toLowerCase() || null,
      };
    });

  dedupeContractions(items);

  if (originalText) {
    return sortByPosition(items, originalText);
  }
  return items;
}

// 축약형 중복 제거: AI가 "it's"(S) + "is"(V) 같이 중첩 출력 시 S text를 "it"으로 트림
const CONTRACTION_SUFFIXES = [
  { suffix: "n't", expansions: new Set(['not']) },
  { suffix: "'ve", expansions: new Set(['have']) },
  { suffix: "'re", expansions: new Set(['are']) },
  { suffix: "'ll", expansions: new Set(['will']) },
  { suffix: "'m",  expansions: new Set(['am']) },
  { suffix: "'s",  expansions: new Set(['is', 'has']) },
  { suffix: "'d",  expansions: new Set(['would', 'had']) },
];

function dedupeContractions(items) {
  for (const item of items) {
    if (!item.text) continue;
    const lower = item.text.toLowerCase();
    for (const { suffix, expansions } of CONTRACTION_SUFFIXES) {
      if (!lower.endsWith(suffix)) continue;
      // 다른 항목이 해당 축약형의 확장형과 일치하면 트림
      const hasExpansion = items.some(other =>
        other !== item && expansions.has((other.text || '').toLowerCase())
      );
      if (hasExpansion) {
        item.text = item.text.slice(0, -suffix.length);
        break;
      }
    }
  }
}

function sortByPosition(grammar, originalText) {
  const lower = originalText.toLowerCase();
  const used = new Set();

  // 원본 배열 순서를 보존하기 위해 인덱스 부여
  const withIdx = grammar.map((g, i) => ({ ...g, _origIdx: i, _pos: -1 }));

  // ─── 1차: 긴 청크부터 원문에서 위치 탐색 ───
  // 긴 청크가 짧은 청크(is, a 등)보다 먼저 자기 영역을 선점해야
  // 짧은 청크가 긴 청크 내부의 부분 매치를 먹어버리는 사태를 방지.
  const byLength = [...withIdx].sort((a, b) => b.text.length - a.text.length);

  for (const g of byLength) {
    const tl = g.text.toLowerCase();
    let pos = -1;
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(tl, from);
      if (idx < 0) break;
      let overlap = false;
      for (let i = idx; i < idx + tl.length; i++) {
        if (used.has(i)) { overlap = true; break; }
      }
      if (!overlap) {
        for (let i = idx; i < idx + tl.length; i++) used.add(i);
        pos = idx;
        break;
      }
      from = idx + 1;
    }
    // withIdx의 해당 항목에 pos 반영 (동일 참조)
    withIdx[g._origIdx]._pos = pos;
  }

  // ─── 2차: 찾지 못한 항목은 AI가 배치한 순서의 앞뒤 항목 사이로 보정 ───
  // 예: "it's"에서 분리된 "is"는 원문에 없음 → 앞뒤 이웃 사이에 끼움
  for (let i = 0; i < withIdx.length; i++) {
    if (withIdx[i]._pos < 0) {
      let prev = -Infinity;
      for (let j = i - 1; j >= 0; j--) {
        if (withIdx[j]._pos >= 0) { prev = withIdx[j]._pos; break; }
      }
      let next = Infinity;
      for (let j = i + 1; j < withIdx.length; j++) {
        if (withIdx[j]._pos >= 0) { next = withIdx[j]._pos; break; }
      }
      if (prev > -Infinity && next < Infinity) {
        withIdx[i]._pos = (prev + next) / 2;
      } else if (prev > -Infinity) {
        withIdx[i]._pos = prev + 0.5;
      } else if (next < Infinity) {
        withIdx[i]._pos = next - 0.5;
      }
      // 양쪽 다 못 찾으면 _pos = -1 유지 → 마지막에 배치
    }
  }

  // ─── 3차: 최종 위치 오름차순 정렬 ───
  return withIdx
    .sort((a, b) => {
      if (a._pos < 0 && b._pos < 0) return 0;
      if (a._pos < 0) return 1;
      if (b._pos < 0) return -1;
      return a._pos - b._pos;
    })
    .map(({ _pos, _origIdx, ...rest }) => rest);
}

// 기본 관사/대명사만 제외, 조동사·전치사 등은 유지
const SKIP_WORDS = new Set([
  'the','a','an','i','me','my','you','your','he','him','his',
  'she','her','it','its','we','us','our','they','them','their',
  'this','that','these','those','and','but','or','so','yet','nor',
]);

function filterWords(words) {
  return (words || []).filter(w => !SKIP_WORDS.has((w.word || '').toLowerCase()));
}

function normalizeTranslation(translation) {
  if (!translation) return '';
  if (typeof translation === 'string') return translation;
  return translation.full || translation.text || String(translation);
}


// ════════════════════════════════════════════════
// 공개 API
// ════════════════════════════════════════════════
export async function analyzeText(text, signal) {
  // 단어 하나만 선택 시 사전 모드
  if (!text.includes(' ')) {
    const data = await callGemini(WORD_PROMPT, text, signal);
    return { type: 'word', data };
  }

  const data = await callGemini(ANALYZE_PROMPT, `Analyze this sentence: "${text}"`, signal);
  return {
    type: 'grammar',
    original: text,
    normalized: data.normalized || text,
    normalization_notes: data.normalization_notes || '',
    is_complete: data.is_complete !== false,
    translation: normalizeTranslation(data.translation),
    grammar: normalizeGrammar(data.grammar, LAYER0_ROLES, data.normalized || text),
    words: filterWords(data.words),
  };
}

export async function drilldownText(text, parentRole, signal) {
  const data = await callGemini(DRILLDOWN_PROMPT, `Parent role: ${parentRole}\nText to drill into: "${text}"`, signal);
  return {
    grammar: normalizeGrammar(data.grammar, LAYER1_ROLES, text),
    translation: normalizeTranslation(data.translation),
  };
}
