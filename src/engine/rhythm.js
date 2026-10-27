// Stage 5: sentence rhythm ("burstiness"). Uniform sentence length is a mark of chat-model prose, so in a
// paragraph with 4+ sentences and a low coefficient of variation (CV = stdev / mean of sentence lengths)
// we merge a pair of short sentences or split the longest one: at most 2 operations per paragraph, each kept
// only if it raises the CV. Everything is deterministic.
import { wordCount, splitSentences, capitalize, lc } from './util.js'
import { hasEarlyVerb, tagsAt } from './nlp.js'

export const CV_TARGET = 0.35

export function cv(lens) {
  if (lens.length < 2) return 0
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length
  if (!mean) return 0
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
  return sd / mean
}

const PRONOUN = /^(it|this|that|they|these|he|she)\b/i
const ADVERB = /^(?:also|still|often|just|even|now|never|always|usually|can|may|will|could|would|should)$/i
const lowerFirst = (s) => s.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase())
const firstWord = (s) => (s.trim().match(/^[^\s,;:.!?]+/) || [''])[0].toLowerCase()
const PLAIN_END = /[^.!?]\.$/
const SPLIT_OFF = /^(?:This|That) (?:(?:can|may|could|might|will|would) )?(?:[a-z]+ly )?(?:leads?|led|results?|resulted|causes?|caused|makes?|made|allows?|allowed|enables?|enabled|creates?|created|gives?|gave|provides?|provided|helps?|helped|ensures?|ensured|builds?|built|contributes?|contributed|drives?|drove|boosts?|boosted|reduces?|reduced)\b/
const OPEN_THE = /^(?:the|a|an|this|that|these|those|many|some|each|most|their|our|his|her|its|such)$/i

// Merge sentence i with sentence i+1. Returns the joined text (with b's trailing whitespace) or null.
function mergePair(a, b, parity, relaxed) {
  const A = a.trimEnd()
  const B = b.trimEnd()
  const tail = b.slice(B.length)
  if (!PLAIN_END.test(A) || !/[.]$/.test(B)) return null
  // Do not glue back a "This leads to ..." sentence that the participle-tail pass just split off.
  if (SPLIT_OFF.test(B)) return null
  const A0 = A.slice(0, -1)
  const first = firstWord(B)
  let out = null
  if (first === 'but' && /^But\s+\S/.test(B)) out = `${A0}, but ${lowerFirst(B.slice(4).trimStart())}`
  else if (first === 'so' && /^So\s+[A-Za-z]/.test(B)) out = `${A0}, so ${lowerFirst(B.slice(3).trimStart())}`
  else if (PRONOUN.test(B)) {
    const pron = PRONOUN.exec(B)[1]
    const rest = B.slice(pron.length).trimStart()
    const same = firstWord(A) === lc(pron)
    // He / she / they only join a sentence they continue; it / this / that / these refer back to any sentence.
    if (!same && /^(?:he|she|they)$/i.test(pron)) return null
    const words = rest.split(/\s+/)
    let k = 0
    while (k < words.length - 1 && ADVERB.test(words[k]) && !/^(?:can|may|will|could|would|should)$/i.test(words[k])) k++
    const restOff = B.length - rest.length
    const verbOff = restOff + words.slice(0, k).join(' ').length + (k ? 1 : 0)
    const isVerb = /^(?:can|may|will|could|would|should)$/i.test(words[k]) || tagsAt(B, verbOff).has('Verb')
    if (same && isVerb) out = `${A0} and ${rest}`
    else out = parity ? `${A0}, and ${lowerFirst(B)}` : `${A0}; ${lowerFirst(B)}`
  } else if (relaxed && OPEN_THE.test(first) && firstWord(A) === first) out = `${A0}; ${lowerFirst(B)}`
  if (!out || wordCount(out) > 28) return null
  return out + tail
}

// Split one long sentence at the safest boundary closest to its middle. Returns [left, right] or null.
const WHICH = /,\s+which\s+(is|was|makes|made|means|can|could|allows|enables|leads|results|helps|creates|causes|shows|suggests|explains|gives|has|had|will|would)\b\s*/gi
const OPENERS = /^(?:it|they|he|she|we|you|this|that|these|those|there|the|a|an|their|its|our|many|most|some|each|such)$/i

function splitLong(s) {
  const body = s.trimEnd()
  const tail = s.slice(body.length)
  const mid = body.length / 2
  const cands = []
  for (const c of body.matchAll(WHICH)) cands.push({ i: c.index, len: c[0].length, mk: (r) => `This ${c[1]} ${r}` , raw: true, rest: body.slice(c.index + c[0].length) })
  for (const c of body.matchAll(/;\s+/g)) cands.push({ i: c.index, len: c[0].length, mk: (r) => capitalize(r), rest: body.slice(c.index + c[0].length) })
  for (const c of body.matchAll(/,\s+and\s+/gi)) cands.push({ i: c.index, len: c[0].length, mk: (r) => capitalize(r), rest: body.slice(c.index + c[0].length), clause: true })
  for (const c of body.matchAll(/,\s+but\s+/gi)) cands.push({ i: c.index, len: c[0].length, mk: (r) => `But ${r}`, rest: body.slice(c.index + c[0].length), clause: true })
  let best = null
  for (const c of cands) {
    const left = body.slice(0, c.i)
    if (wordCount(left) < 7 || wordCount(c.rest) < 5) continue
    if (c.clause && !(OPENERS.test(firstWord(c.rest)) && hasEarlyVerb(c.rest))) continue
    if (c.raw && wordCount(c.rest) < 2) continue
    if (!best || Math.abs(c.i - mid) < Math.abs(best.i - mid)) best = c
  }
  if (!best) return null
  const right = best.raw ? best.mk(best.rest) : best.mk(best.rest)
  return [body.slice(0, best.i).trimEnd().replace(/[,;]$/, '') + '. ', right + tail]
}

function rhythmLine(line) {
  let sents = splitSentences(line)
  if (sents.length < 4) return [line, 0]
  const lens = () => sents.map(wordCount)
  let ops = 0

  // Three sentences in a row starting with the same word: merge the last two.
  for (let i = 0; i + 2 < sents.length && ops < 2; i++) {
    const w = firstWord(sents[i])
    if (w && w === firstWord(sents[i + 1]) && w === firstWord(sents[i + 2])) {
      const m = mergePair(sents[i + 1], sents[i + 2], i % 2, true)
      if (m) {
        sents = [...sents.slice(0, i + 1), m, ...sents.slice(i + 3)]
        ops++
      }
    }
  }

  while (ops < 2 && sents.length >= 3 && cv(lens()) < CV_TARGET) {
    const before = cv(lens())
    let next = null
    for (let i = 0; i + 1 < sents.length && !next; i++) {
      if (wordCount(sents[i]) > 12 || wordCount(sents[i + 1]) > 12) continue
      const m = mergePair(sents[i], sents[i + 1], i % 2, false)
      if (m) next = [...sents.slice(0, i), m, ...sents.slice(i + 2)]
    }
    if (!next) {
      const order = sents.map((s, i) => [wordCount(s), i]).filter(([n]) => n > 24).sort((a, b) => b[0] - a[0])
      for (const [, i] of order) {
        const sp = splitLong(sents[i])
        if (sp) {
          next = [...sents.slice(0, i), sp[0], sp[1], ...sents.slice(i + 1)]
          break
        }
      }
    }
    if (!next || cv(next.map(wordCount)) <= before) break
    sents = next
    ops++
  }
  return [sents.join(''), ops]
}

// The original rule: any sentence over 30 words is split at "; ", ", and " or ", but " near its middle.
function longSentences(text) {
  let n = 0
  const out = text.split('\n').map((line) => {
    const pieces = splitSentences(line)
    return pieces
      .map((p) => {
        if (wordCount(p) <= 30) return p
        const cands = [...p.matchAll(/;\s+|,\s+and\s+|,\s+but\s+/gi)]
        const mid = p.length / 2
        let best = null
        for (const c of cands) {
          const l = wordCount(p.slice(0, c.index))
          const r = wordCount(p.slice(c.index + c[0].length))
          if (l < 8 || r < 8) continue
          if (!best || Math.abs(c.index - mid) < Math.abs(best.index - mid)) best = c
        }
        if (!best) return p
        n++
        const left = p.slice(0, best.index).replace(/[ \t]+$/, '') + '.'
        let right = p.slice(best.index + best[0].length)
        if (/^,\s+but/i.test(best[0])) right = 'but ' + right
        right = right.replace(/^[a-z]/, (c) => c.toUpperCase())
        return left + ' ' + right
      })
      .join('')
  })
  return [out.join('\n'), n]
}

const LIST_LINE = /^\s*(?:[-*+>|#]|\d+[.)])\s/

export function rhythm(text, add) {
  const [t0, split] = longSentences(text)
  if (split) add('Long sentences split', split)
  let total = 0
  const out = t0
    .split('\n')
    .map((line) => {
      if (!line.trim() || LIST_LINE.test(line)) return line
      const [res, ops] = rhythmLine(line)
      total += ops
      return res
    })
    .join('\n')
  if (total) add('Sentence rhythm varied', total)
  return out
}
