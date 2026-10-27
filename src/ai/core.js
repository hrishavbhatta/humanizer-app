// Pure helpers for the optional on-device AI rewrite: splitting text into model-sized chunks,
// building the prompt, cleaning the model's reply and validating it. No native or DOM code here,
// so tests/ai.mjs can run it in Node.

const ABBREVIATIONS = /(?:^|[\s("'])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|inc|ltd|no|fig|e\.g|i\.e|u\.s|u\.k|[a-z])\.$/i
const MAX_SENTENCES = 3
const MAX_CHUNK_WORDS = 55

const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0)

// A line the model must never see: headings, list items, block quotes, code fences, table rows, very short labels.
const STRUCTURAL_LINE = /^\s*(?:#{1,6}\s|[-*+•]\s|\d{1,3}[.)]\s|>\s|```|\||={3,}|-{3,})/
// A sentence the model must never see: quoted speech, inline code, links, emails.
const PROTECTED_SENTENCE = /["“”`]|https?:\/\/|www\.|\S+@\S+\.\S/

export function splitSentences(paragraph) {
  const parts = paragraph.split(/(?<=[.!?]["')\]]*)\s+(?=["'([]*[A-Z0-9])/)
  const out = []
  for (const p of parts) {
    if (out.length && ABBREVIATIONS.test(out[out.length - 1])) out[out.length - 1] += ' ' + p
    else out.push(p)
  }
  return out.filter((s) => s.trim())
}

/**
 * Split text into segments. { keep: true, text } segments are passed through untouched; { keep: false, text }
 * segments are 1 to 3 sentences of plain prose that go to the model. Joining all segment texts in order gives
 * back the original text exactly.
 */
export function segment(text) {
  const segments = []
  const pushKeep = (t) => {
    if (!t) return
    const last = segments[segments.length - 1]
    if (last && last.keep) last.text += t
    else segments.push({ keep: true, text: t })
  }

  // Alternate: line, separator (newlines), line, ...
  const pieces = text.split(/(\n+)/)
  for (const piece of pieces) {
    if (!piece) continue
    if (/^\n+$/.test(piece) || !piece.trim() || STRUCTURAL_LINE.test(piece) || words(piece) < 8) {
      pushKeep(piece)
      continue
    }
    const lead = piece.match(/^\s*/)[0]
    const trail = piece.match(/\s*$/)[0]
    pushKeep(lead)
    let first = true
    const emitKeep = (t) => {
      pushKeep((first ? '' : ' ') + t)
      first = false
    }
    let group = []
    let groupWords = 0
    const flush = () => {
      if (!group.length) return
      if (!first) pushKeep(' ')
      segments.push({ keep: false, text: group.join(' ') })
      first = false
      group = []
      groupWords = 0
    }
    for (const s of splitSentences(piece.trim())) {
      const w = words(s)
      if (PROTECTED_SENTENCE.test(s) || w < 4) {
        flush()
        emitKeep(s)
        continue
      }
      if (group.length && (group.length >= MAX_SENTENCES || groupWords + w > MAX_CHUNK_WORDS)) flush()
      group.push(s)
      groupWords += w
    }
    flush()
    pushKeep(trail)
  }
  return segments
}

export const SYSTEM_PROMPT = 'You are a plain-spoken editor. You rewrite text in simple, everyday English.'

// Tuned on Qwen2.5-0.5B-Instruct (see README): explicit rules beat a short instruction for keeping facts and
// stopping the model from adding hype words; a one-shot example made it change more but also invent facts.
export function instruction(chunk) {
  const rules = [
    'Rewrite this text so it sounds like a person wrote it.',
    'Rules:',
    '- Use plain everyday words. No hype or dramatic words such as dramatically, seamlessly, pivotal, essential, profound.',
    '- Keep the same facts in the same order. Keep every name and number exactly.',
    '- Do not add any new claims or details.',
    '- Mix short and long sentences. Keep about the same length.',
    '- Reply with only the rewritten text.',
    '',
    'Text:',
    chunk,
  ]
  return rules.join('\n')
}

// Qwen2.5 chat format (ChatML). The model file is used through MediaPipe, which does not apply a template itself.
export function buildPrompt(chunk) {
  return (
    `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n` +
    `<|im_start|>user\n${instruction(chunk)}<|im_end|>\n` +
    '<|im_start|>assistant\n'
  )
}

/** Remove chat tokens, preambles, wrapping quotes and trailing notes the model sometimes adds. */
export function cleanOutput(raw, source) {
  let t = String(raw ?? '')
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/\\n/g, '\n')
    .trim()
  // Preamble line such as "Here is the rewritten text:" or "Sure! Here's a version:".
  for (let i = 0; i < 2; i++) {
    const before = t
    t = t.replace(/^(?:sure|certainly|of course|okay|ok|here(?:'s| is| are)|rewritten text|rewritten version|rewrite|output)\b[^\n]{0,80}?:\s*/i, '')
    t = t.replace(/^(?:sure|certainly|of course|okay)[!.,]\s*/i, '')
    if (t === before) break
  }
  // Trailing commentary: a final paragraph starting with Note:, This rewrite..., I have...
  t = t.replace(/\n+\s*(?:note|notes|explanation|changes)\s*:[\s\S]*$/i, '')
  t = t.replace(/\n+\s*(?:this (?:rewrite|version|text)|i (?:have|kept|made|changed)|the (?:rewritten|above))[\s\S]*$/i, '')
  // Wrapping quotes, unless the source itself starts with a quote.
  if (!/^["“']/.test(source.trim())) {
    t = t.replace(/^["“](.*)["”]$/s, '$1').trim()
  }
  // Source chunks are one paragraph: collapse line breaks and stray spaces.
  if (!source.includes('\n')) t = t.replace(/\s*\n+\s*/g, ' ')
  return t.replace(/[ \t]{2,}/g, ' ').trim()
}

const numbersOf = (s) => s.match(/\d+(?:[.,]\d+)*/g) || []

// Capitalised words that are not at the start of a sentence are treated as names; ALL-CAPS words as acronyms.
function namesOf(s) {
  const found = new Set()
  const toks = s.match(/\S+/g) || []
  let start = true
  for (const tok of toks) {
    const word = (tok.match(/^["'([“]*([A-Za-z][A-Za-z'’-]*)/) || [])[1]
    if (word && /^[A-Z]/.test(word)) {
      if (/^[A-Z]{2,}$/.test(word)) found.add(word)
      else if (!start && word !== 'I' && !/^I['’]/.test(word)) found.add(word.replace(/['’]s$/, ''))
    }
    start = /[.!?]["')\]”]*$/.test(tok) && !ABBREVIATIONS.test(' ' + tok.replace(/["')\]”]+$/, ''))
  }
  return found
}

// Anything that is not Latin script, punctuation, digits, symbols or whitespace (CJK, Cyrillic, Arabic, ...).
const NON_LATIN = /[^p{Script=Latin}p{P}p{N}p{S}sp{M}]/u

const CHATTER = /\b(?:here is|here's|here are|sure[,!.]|certainly[,!.]|of course[,!.]|rewritten|rewriting|rewrite[sd]?|paraphras\w*|as an ai|language model|i hope this|let me know|hope that helps|note that i)\b/i

// Hype words small models like to add. A rewrite may not introduce any that the source did not have.
const HYPE = /\b(?:dramatic\w*|remarkabl\w*|impressiv\w*|exceptional\w*|skyrocket\w*|soar\w*|surg\w*|cutting-edge|ever-evolving|game-chang\w*|stunning\w*|revolution\w*|profound\w*|transformative|unparalleled|seamless\w*|pivotal|tapestry|testament|vibrant|robust|strategic\w*|groundbreaking|state-of-the-art|world-class|unprecedented|indelible|crucial\w*)\b/gi

const hasLoop =(t) => {
  const w = t.toLowerCase().match(/[a-z']+/g) || []
  const seen = new Map()
  for (let i = 0; i + 3 <= w.length; i++) {
    const k = w.slice(i, i + 3).join(' ')
    const n = (seen.get(k) || 0) + 1
    seen.set(k, n)
    if (n >= 3) return true
  }
  return false
}

const STOP = new Set('that this with from have been were will would their there which about into than then them they what when your also more some such only over very much just like even most both each other these those while where after before being could should'.split(' '))
const stems = (s) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)))

/** Share of the source's content words kept, and share of the output's content words that are new. */
export function overlap(src, out) {
  const a = stems(src)
  const b = stems(out)
  let kept = 0
  for (const k of a) if (b.has(k)) kept++
  let fresh = 0
  for (const k of b) if (!a.has(k)) fresh++
  return { recall: a.size ? kept / a.size : 1, novelty: b.size ? fresh / b.size : 0 }
}

/** Returns { ok, reason } for a cleaned model output against its source chunk. */
export function validate(source, output) {
  const src = source.trim()
  const out = output.trim()
  if (!out) return { ok: false, reason: 'empty' }
  if (CHATTER.test(out) && !CHATTER.test(src)) return { ok: false, reason: 'chatter' }
  const ratio = out.length / src.length
  if (ratio < 0.6 || ratio > 1.4) return { ok: false, reason: 'length' }
  if (NON_LATIN.test(out) && !NON_LATIN.test(src)) return { ok: false, reason: 'foreign characters' }
  if (/[\n]\s*(?:[-*•]|\d+[.)])\s/.test(out) || /^#{1,6}\s/.test(out) || /\*\*/.test(out)) return { ok: false, reason: 'formatting' }
  if (hasLoop(out) && !hasLoop(src)) return { ok: false, reason: 'repetition' }
  if (/[.!?]["')\]]*$/.test(src) && !/[.!?]["')\]]*$/.test(out)) return { ok: false, reason: 'cut off' }
  if (!/^[A-Z0-9"'([]/.test(out) && /^[A-Z0-9"'([]/.test(src)) return { ok: false, reason: 'starts lowercase' }

  const hypeIn = new Set((src.match(HYPE) || []).map((w) => w.toLowerCase()))
  const newHype = (out.match(HYPE) || []).find((w) => !hypeIn.has(w.toLowerCase()))
  if (newHype) return { ok: false, reason: `added hype word "${newHype}"` }
  const o = overlap(src, out)
  if (o.recall < 0.5 || o.novelty > 0.5) return { ok: false, reason: 'drifted from the source' }

  const have = new Map()
  for (const n of numbersOf(out)) have.set(n, (have.get(n) || 0) + 1)
  for (const n of numbersOf(src)) {
    const left = (have.get(n) || 0) - 1
    if (left < 0) return { ok: false, reason: `number ${n} missing` }
    have.set(n, left)
  }
  // Numbers that were not in the source are invented facts.
  const known = new Set(numbersOf(src))
  for (const n of numbersOf(out)) if (!known.has(n)) return { ok: false, reason: `new number ${n}` }
  for (const name of namesOf(src)) {
    if (!out.includes(name)) return { ok: false, reason: `name ${name} missing` }
  }
  return { ok: true, reason: '' }
}

/** Largest reply, in characters, worth waiting for: a rewrite should be close to the source length. */
export const maxReplyChars = (source) => Math.ceil(source.length * 1.4) + 60
