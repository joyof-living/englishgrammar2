// gemini.js — Gemini API 연동, 프롬프트, 스키마

const DEFAULT_MODEL = 'gemini-2.5-flash';

function getApiUrl(apiKey, model) {
  const m = model || DEFAULT_MODEL;
  if (apiKey.startsWith('AIza')) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
  }
  return `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`;
}

// ════════════════════════════════════════════════
// PROMPT 1: 정제 + Layer 0 SVOCA 분석
// ════════════════════════════════════════════════
const ANALYZE_PROMPT = `You are an expert English grammar analyst. Process the given text in two steps.

━━━ STEP 1: NORMALIZATION ━━━
Inspect the text for issues:
• Truncated sentence (verb or subject missing) → add [VERB] or [SUBJECT] marker
• Grammar errors in the original → fix punctuation/spelling only
• Non-sentence (headline, button, code snippet, list item) → treat as-is, set is_complete: false
• Multiple sentences → analyze only the first complete one

Normalization rules:
• PRESERVE ALL WORDS — never delete original words
• You may reorder words, fix punctuation, or add [MISSING] markers
• If nothing to fix: set normalized = original, normalization_notes = ""

━━━ STEP 2: LAYER 0 — SVOCA ANALYSIS ━━━
Analyze the NORMALIZED sentence. Divide it into top-level chunks.

Allowed roles:
  "S"            — subject (entire noun phrase)
  "V"            — verb chunk (modal + main verb combined into ONE unit)
  "O"            — direct or indirect object
  "C"            — subject complement or object complement
  "A"            — any adverbial adjunct (time / place / manner / reason / condition)
  "conj"         — coordinating conjunction joining two main clauses (and/but/or/so)
  "interjection" — exclamation (Oh, Wow, Well, etc.) — NOT part of main structure

BUNDLING RULE (critical): Keep complex phrases/clauses as ONE chunk at this layer.
  ✓ "the woman who called you"  → single S chunk
  ✓ "must have been waiting"    → single V chunk
  ✓ "because he was tired"      → single A chunk
  ✓ "can very well be waiting"  → single V chunk (adverbs between auxiliaries stay in V)
  ✗ Do NOT split into sub-parts at Layer 0

Coordination within a phrase: "dogs and cats" = one S chunk (not two separate S chunks).

Set has_substructure: true when a chunk CAN be meaningfully drilled into:
  S / O / C → true if it contains a modifier (relative clause, participial phrase, appositive, etc.)
  V         → true if it contains a modal or auxiliary (is, has, will, can, have been, etc.)
  A         → true if it is a prepositional phrase OR a subordinate adverb clause
  A         → false if it is a single simple adverb (quickly, always, very well, etc.)

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
      "korean": "이 성분의 역할 설명 (간결한 한국어)",
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

━━━ RULE A: Parent = S, O, or C (noun chunk) ━━━
Split into: [head] + [modifier(s)]
  "head"     — the core noun, pronoun, or adjective (for C)
  "modifier" — everything that modifies the head (as one flat item per modifier)

For each modifier, set has_substructure: true and specify what kind it is in the "korean" field:
  • Relative clause  (who/which/that…) → has_substructure: true
  • Participial phrase (running / broken…) → has_substructure: true
  • Infinitive phrase (to do…) → has_substructure: true
  • Simple adjective or determiner → has_substructure: false

━━━ RULE B: Parent = V (verb chunk) ━━━
Split into modal/auxiliary + main verb:
  "MV" — modal or auxiliary (can, will, have, be, would have, etc.)
  "V"  — main verb (base form, -ing, or past participle)

On the V item add:
  "tense": one of present / past / future / present-perfect / past-perfect /
             present-continuous / past-continuous / future-continuous /
             future-perfect / present-perfect-continuous / past-perfect-continuous /
             future-perfect-continuous
  "voice": "active" or "passive"

If there is no modal/auxiliary, return a single "V" item with tense and voice.

━━━ RULE C: Parent = A (adverb chunk) ━━━
Case 1 — Simple adverb: single item role "adv", has_substructure: false
Case 2 — Prepositional phrase:
  "prep" — the preposition
  "O"    — the noun object (follow noun-chunk rules for has_substructure)
Case 3 — Adverb clause:
  "conj" — subordinating conjunction (when / because / although / if / etc.)
  Then break the remainder into: "S" "V" "O" "C" "A"
Case 4 — Infinitive/participial adverb phrase:
  Lowercase roles: "v" "o" "c" "a" (implied/no explicit subject)

━━━ OUTPUT — return ONLY valid JSON ━━━
{
  "grammar": [
    {
      "role": "head|modifier|S|V|O|C|A|MV|prep|conj|v|o|c|a|adv",
      "text": "영어 원문 텍스트",
      "korean": "이 성분의 역할 설명 (한국어)",
      "has_substructure": false,
      "tense": null,
      "voice": null
    }
  ],
  "translation": "이 청크 전체의 한국어 번역 또는 설명"
}

Coverage rule: grammar[].text must together cover every word of the input chunk exactly once.`;


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
  return { apiKey, model: model || DEFAULT_MODEL };
}

async function fetchWithRetry(url, options, retries = 2, delay = 1000) {
  const resp = await fetch(url, options);

  // 503: 서버 과부하 — 재시도
  if (resp.status === 503 && retries > 0) {
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }

  // 429: rate limit — exponential backoff 재시도
  if (resp.status === 429 && retries > 0) {
    const retryAfter = parseInt(resp.headers.get('Retry-After') || '0', 10) * 1000;
    await new Promise(r => setTimeout(r, Math.max(retryAfter, delay)));
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }

  return resp;
}

async function callGemini(prompt, userText, signal) {
  const { apiKey, model } = await getSettings();
  const resp = await fetchWithRetry(`${getApiUrl(apiKey, model)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    signal,
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => null);
    const detail = errBody?.error?.message || '';
    if (resp.status === 401 || resp.status === 403)
      throw new GeminiError('API 키가 유효하지 않습니다. 옵션에서 확인해주세요.', 'auth');
    if (resp.status === 429)
      throw new GeminiError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 'rate_limit');
    if (resp.status === 503)
      throw new GeminiError('서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.', 'api_error');
    throw new GeminiError(`API 오류 (${resp.status}): ${detail || '알 수 없는 오류'}`, 'api_error');
  }

  const json = await resp.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
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
        console.warn('[ET Grammar] Unknown role replaced:', item.role, '→ A');
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

  // 원문 순서대로 정렬
  if (originalText) {
    return sortByPosition(items, originalText);
  }
  return items;
}

function sortByPosition(grammar, originalText) {
  const lower = originalText.toLowerCase();
  const used = new Set();
  return grammar
    .map(g => {
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
      return { ...g, _pos: pos };
    })
    .sort((a, b) => {
      if (a._pos < 0 && b._pos < 0) return 0;
      if (a._pos < 0) return 1;
      if (b._pos < 0) return -1;
      return a._pos - b._pos;
    })
    .map(({ _pos, ...rest }) => rest);
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
