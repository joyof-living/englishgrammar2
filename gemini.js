// gemini.js — Gemini API 연동, 프롬프트, 스키마

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// ════════════════════════════════════════════════
// PROMPT 1: 정제 + Layer 0 SVOCA 분석
// ════════════════════════════════════════════════
const ANALYZE_PROMPT = `You are an expert English grammar analyst. Process the given text in two steps.

━━━ STEP 1: NORMALIZATION ━━━
Inspect the text for issues:
• Truncated sentence (verb or subject missing)
• Grammar errors in the original
• Non-sentence (headline, button, code snippet, list item)
• Multiple sentences → analyze only the first complete one

Normalization rules:
• PRESERVE ALL WORDS — never delete original words
• You may reorder words, fix punctuation, or add [missing element] markers
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
  ✗ Do NOT split into sub-parts at Layer 0

Set has_substructure: true when a chunk CAN be meaningfully drilled into:
  S / O / C → true if it contains a modifier (relative clause, participial phrase, appositive, etc.)
  V         → true if it contains a modal or auxiliary (is, has, will, can, have been, etc.)
  A         → true if it is a prepositional phrase OR a subordinate adverb clause
  A         → false if it is a single simple adverb (quickly, always, etc.)

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
Words list: include content words only (omit articles, basic auxiliaries, common pronouns).`;


// ════════════════════════════════════════════════
// PROMPT 2: Layer 1 드릴다운 분석
// ════════════════════════════════════════════════
const DRILLDOWN_PROMPT = `You are an expert English grammar analyst. Drill down into a single English chunk.
The chunk's parent role (S / V / O / C / A) is provided. Apply the matching rule below.

━━━ RULE A: Parent = S, O, or C (noun chunk) ━━━
Split into: [head] + [modifier(s)]
  "head"     — the core noun, pronoun, or adjective (for C)
  "modifier" — everything that modifies the head

For each modifier, set has_substructure: true and specify what kind it is in the "korean" field:
  • Relative clause  (who/which/that…) → has_substructure: true
  • Participial phrase (running / broken…) → has_substructure: true
  • Infinitive phrase (to do…) → has_substructure: true
  • Simple adjective or determiner → has_substructure: false

If a modifier has_substructure = true, ALSO include its internal breakdown as child items
  using roles: "S" "V" "O" "C" "A" (for finite clauses) or "v" "o" "c" "a" (for non-finite phrases).

━━━ RULE B: Parent = V (verb chunk) ━━━
Split into modal/auxiliary + main verb:
  "MV" — modal or auxiliary (can, will, have, be, would have, etc.)
  "V"  — main verb (base form, -ing, or past participle)

On the V item add:
  "tense": one of present / past / future / present-perfect / past-perfect /
             present-continuous / past-continuous / future-perfect / etc.
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
// API 호출
// ════════════════════════════════════════════════
class GeminiError extends Error {
  constructor(message, errorType = 'api_error') {
    super(message);
    this.errorType = errorType;
    this.name = 'GeminiError';
  }
}

async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) throw new GeminiError('API 키가 설정되지 않았습니다.', 'auth');
  return apiKey;
}

async function callGemini(prompt, userText) {
  const apiKey = await getApiKey();
  const resp = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
  });

  if (resp.status === 401 || resp.status === 403)
    throw new GeminiError('API 키가 유효하지 않습니다. 옵션에서 확인해주세요.', 'auth');
  if (resp.status === 429)
    throw new GeminiError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 'rate_limit');
  if (!resp.ok)
    throw new GeminiError(`API 오류가 발생했습니다 (${resp.status}).`, 'api_error');

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

function normalizeGrammar(grammar, validRoles) {
  if (!Array.isArray(grammar)) return [];
  return grammar
    .map(item => ({
      role: validRoles.has(item.role) ? item.role : 'A',
      text: String(item.text || '').trim(),
      korean: String(item.korean || '').trim(),
      has_substructure: !!item.has_substructure,
      tense: item.tense || null,
      voice: item.voice || null,
    }))
    .filter(item => item.text);
}

const SKIP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','must','to','of','in',
  'on','at','by','for','with','from','into','that','this',
  'these','those','it','its','they','them','their','he','she',
  'his','her','we','our','you','your','i','my','me','and',
  'but','or','so','yet','nor','not','also','just','very',
]);

function filterWords(words) {
  return (words || []).filter(w => !SKIP_WORDS.has((w.word || '').toLowerCase()));
}


// ════════════════════════════════════════════════
// 공개 API
// ════════════════════════════════════════════════
export async function analyzeText(text) {
  const data = await callGemini(ANALYZE_PROMPT, `Analyze this sentence: "${text}"`);
  return {
    original: text,
    normalized: data.normalized || text,
    normalization_notes: data.normalization_notes || '',
    is_complete: data.is_complete !== false,
    translation: String(data.translation || ''),
    grammar: normalizeGrammar(data.grammar, LAYER0_ROLES),
    words: filterWords(data.words),
  };
}

export async function drilldownText(text, parentRole) {
  const data = await callGemini(DRILLDOWN_PROMPT, `Parent role: ${parentRole}\nText to drill into: "${text}"`);
  return {
    grammar: normalizeGrammar(data.grammar, LAYER1_ROLES),
    translation: String(data.translation || ''),
  };
}
