// Offline, deterministic, rule-based humanizer. Never invents content.
//
// Follows src/humanizer-skill.md (Wikipedia "Signs of AI writing") plus the grammatical tells found in
// research on chat-model prose. Pipeline (each stage is a quality-gated unit; a stage whose result fails
// validation is reverted):
//   0  Clean input     NFKC, invisible characters, look-alike letters, curly quotes
//   1  Protect spans   quotes, backtick code, emails, URLs, numbers with units (restored at the end)
//   2  Rules           chatbot artifacts, staged openers, filler, stock words, sales language, ... (rules.js)
//   3  Grammar tells   nominalizations, participle tails, "it is essential for X to", transitions,
//                      plain-language swaps, intensifiers (grammar.js, words.js)
//   4  Contractions
//   5  Rhythm          vary sentence length when it is uniform (rhythm.js)
//   6  Cleanup + final validation (protected spans and every number must survive)
//
// Sections of the checklist covered (fully or in part): 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 17, 18, 19, 20, 21, 22,
// 23 (not only/but also), 24, 25, 26, 27, 28, 33. (34 skipped: removing "This is not to say that" flips the meaning.)
// Intentionally NOT automated because they need judgment about meaning or voice: 10, 11, 12, 13, 29, 30, 31, 32, 35.
import { QS, QE, PS, PE, MARK, settle } from './util.js'
import { STEPS, contractions } from './rules.js'
import { GRAMMAR_STEPS } from './grammar.js'
import { rhythm } from './rhythm.js'
import { analyze } from './analyze.js'

export { analyze }

// ---- Stage 0: clean input ----
const INVISIBLE = /[\u200B\u200C\u200E\u200F\u2060\u2061-\u2064\uFEFF\u00AD\u202A-\u202E\u2066-\u2069]/g
const HOMOGLYPHS = Object.fromEntries(
  Object.entries({
    A: '\u0410\u0391', B: '\u0412\u0392', C: '\u0421\u03F9', E: '\u0415\u0395', H: '\u041D\u0397', I: '\u0406\u0399\u04C0', J: '\u0408', K: '\u041A\u039A', M: '\u041C\u039C', N: '\u039D', O: '\u041E\u039F', P: '\u0420\u03A1', S: '\u0405', T: '\u0422\u03A4', X: '\u0425\u03A7', Y: '\u03A5\u04AE', Z: '\u0396',
    a: '\u0430', c: '\u0441', e: '\u0435', i: '\u0456', j: '\u0458', o: '\u043E\u03BF', p: '\u0440', s: '\u0455', x: '\u0445', y: '\u0443', d: '\u0501', l: '\u04CF', v: '\u03BD', k: '\u03BA',
  }).flatMap(([latin, chars]) => [...chars].map((c) => [c, latin])),
)

function cleanInput(text, add) {
  let t = text.normalize('NFKC').replace(/(\d)\u2044(\d)/g, '$1/$2')
  t = t.replace(INVISIBLE, () => (add('Hidden characters cleaned'), ''))
  // A zero-width joiner is only kept inside emoji sequences.
  t = t.replace(/\u200D/g, (m, off, s) => (/\p{Extended_Pictographic}[\uFE0F]?$/u.test(s.slice(Math.max(0, off - 3), off)) ? m : (add('Hidden characters cleaned'), '')))
  t = t.replace(/\p{L}+/gu, (w) => {
    if (!/[A-Za-z]/.test(w) || !/[^\u0020-\u024F]/.test(w)) return w
    let changed = false
    const out = [...w].map((c) => (HOMOGLYPHS[c] ? ((changed = true), HOMOGLYPHS[c]) : c)).join('')
    if (changed) add('Hidden characters cleaned')
    return out
  })
  // §19 curly quotes to straight (done first, so quoted text is protected in its final form)
  return t.replace(/[“”]/g, () => (add('Curly quotes'), '"')).replace(/[‘’]/g, "'")
}

// ---- Stage 1: protect spans ----
const NUM_UNITS = '(?:percent|per cent|million|billion|trillion|thousand|hundred|km|kg|mg|cm|mm|ml|lbs?|mph|kph|ft|miles?|kilometers?|kilometres?|meters?|metres?|hours?|minutes?|seconds?|years?|days?|months?|weeks?|GB|MB|KB|TB|Hz|GHz|MHz)'
const NUM = new RegExp(`[$€£¥]?\\d+(?:[,.:/]\\d+)*(?:[-–]\\d+(?:[,.:/]\\d+)*)?(?:%|k\\b|(?:st|nd|rd|th|s)\\b|\\s?${NUM_UNITS}\\b)?`, 'g')

// One pass, leftmost match wins, so a number or URL inside a quote stays part of the quote.
const SPAN = new RegExp(
  [
    '(`[^`\\n]+`)', // 1: code
    '("[^"\\n]*")', // 2: quote
    '([\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+)', // 3: email
    '((?:https?:\\/\\/|www\\.)[^\\s<>]*[^\\s<>.,;:!?)"\'\\]])', // 4: URL
    '(\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:com|org|net|edu|gov|io|co|uk|app|dev|ai)\\b(?:\\/[^\\s<>]*[^\\s<>.,;:!?)"\'\\]])?)', // 5: bare domain
    '(' + NUM.source + ')', // 6: number
  ].join('|'),
  'gi',
)

function protect(text) {
  const spans = []
  const t = text.replace(SPAN, (m, ...g) => {
    const off = g[g.length - 2]
    const s = g[g.length - 1]
    // "1." at the start of a line is a list marker, not a number to protect
    if (g[5] && /(?:^|\n)[ \t]*$/.test(s.slice(0, off)) && /^[.)]\s/.test(s.slice(off + m.length, off + m.length + 2))) return m
    spans.push(m)
    return g[1] ? QS + (spans.length - 1) + QE : PS + (spans.length - 1) + PE
  })
  return { text: t, spans }
}

function restore(text, spans) {
  const re = new RegExp('[' + QS + PS + '](\\d+)[' + QE + PE + ']', 'g')
  const any = new RegExp('[' + QS + PS + ']\\d+[' + QE + PE + ']')
  let t = text
  for (let i = 0; i < 4 && any.test(t); i++) t = t.replace(re, (_, k) => spans[+k])
  return t
}

// ---- Quality gate ----
const placeholders = (t) => (t.match(new RegExp(`[${QS}${PS}]\\d+[${QE}${PE}]`, 'g')) || []).sort().join('|')
const count = (t, re) => (t.match(re) || []).length

function violations(t) {
  const s = t.replace(new RegExp(MARK, 'g'), '')
  let n = 0
  for (const m of s.match(/\b([A-Za-z]+)\s+\1\b/gi) || []) if (!/^(?:that that|had had)$/i.test(m.replace(/\s+/, ' '))) n++
  n += count(s, /[ \t][,;:!?]/g) + count(s, /,,/g) + count(s, /(?<!\.)\.\.(?!\.)/g) + count(s, /,\./g)
  n += count(s, /(?:^|[.!?]\s+)[.!?]/g) // empty sentence
  return n
}
const brackets = (t) => ['"', '(', ')', '[', ']'].map((c) => count(t, new RegExp('\\' + c, 'g'))).join(',')

function valid(before, after) {
  if (placeholders(before) !== placeholders(after)) return false
  if (brackets(before) !== brackets(after)) return false
  return violations(after) <= violations(before)
}

// ---- Final verification on the restored text ----
const numbersOf = (s) => (s.match(/\d+(?:[.,]\d+)*/g) || []).sort()
function survives(input, output, spans) {
  if (spans.some((s) => !output.includes(s))) return false
  const want = new Map()
  for (const n of numbersOf(input)) want.set(n, (want.get(n) || 0) + 1)
  for (const n of numbersOf(output)) want.set(n, (want.get(n) || 0) - 1)
  return [...want.values()].every((v) => v <= 0)
}

export function humanize(input) {
  const tally = new Map()
  const addTo = (m) => (label, n = 1) => m.set(label, (m.get(label) || 0) + n)
  const add = addTo(tally)

  const original = String(input ?? '')
  const before = analyze(original)
  const cleaned = cleanInput(original, add)
  const { text: protectedText, spans } = protect(cleaned)
  let t = settle(protectedText)

  const stages = [...STEPS, ...GRAMMAR_STEPS, ['contractions', contractions], ['rhythm', rhythm]]
  for (const [, fn] of stages) {
    const local = new Map()
    let next
    try {
      next = settle(fn(t, addTo(local)))
    } catch {
      continue
    }
    if (next === t || !valid(t, next)) continue
    t = next
    for (const [label, n] of local) add(label, n)
  }

  let out = restore(t, spans)
  if (!survives(cleaned, out, spans)) {
    // Safety net: never return text that lost a number or protected span.
    out = restore(settle(protectedText), spans)
    for (const k of [...tally.keys()]) if (k !== 'Hidden characters cleaned' && k !== 'Curly quotes') tally.delete(k)
  }
  out = out.trim()
  return { text: out, changes: [...tally].map(([label, n]) => ({ label, n })), before, after: analyze(out) }
}
