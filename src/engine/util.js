// Shared constants and helpers for the engine. The private-use characters below never occur in real text.
export const QS = '\uE000' // quote placeholder start
export const QE = '\uE001' // quote placeholder end
export const MARK = '\uE002' // "something was removed here": used to re-capitalize afterwards
export const PS = '\uE003' // other protected span start (numbers, URLs, emails, code)
export const PE = '\uE004' // other protected span end

// Lookbehind: position is at a sentence or paragraph start.
export const SENT = '(?<=^|[.!?]["\'”’)\\]]*\\s+|\\n[ \\t]*|\\uE002)'

export const lc = (s) => s.toLowerCase()

export function matchCase(orig, rep) {
  if (!rep) return rep
  const c = orig[0]
  if (c !== c.toLowerCase() && c === c.toUpperCase()) return rep[0].toUpperCase() + rep.slice(1)
  return rep
}

export const capitalize = (s) => s.replace(/^[^\p{L}]*\p{Ll}/u, (m) => m.slice(0, -1) + m.slice(-1).toUpperCase())

export const wordCount = (s) => s.split(/\s+/).filter((w) => w.replace(new RegExp(MARK, 'g'), '')).length

// Run regex `re` over `text`; fn(match, text) returns [replacement, endIndex] to replace
// text[match.index .. endIndex], or null to leave the match alone. Returns [newText, count].
export function rewrite(text, re, fn) {
  let out = ''
  let last = 0
  let n = 0
  re.lastIndex = 0
  let m
  while ((m = re.exec(text))) {
    if (m[0] === '') {
      re.lastIndex++
      continue
    }
    if (m.index < last) continue
    const r = fn(m, text)
    if (!r) continue
    out += text.slice(last, m.index) + r[0]
    last = r[1]
    n++
    re.lastIndex = Math.max(re.lastIndex, last)
  }
  return [out + text.slice(last), n]
}

// Settle pending removals: collapse MARKs, re-capitalize after them, fix spacing and punctuation.
export function settle(t) {
  t = t.replace(new RegExp(`(${MARK}[ \\t]*)+`, 'g'), MARK)
  t = t.replace(new RegExp(`(^\\s*|[.!?]["'”’)\\]]*[ \\t]+|\\n[ \\t]*)${MARK}([a-z])`, 'g'), (_, p, c) => p + c.toUpperCase())
  t = t.replace(new RegExp(MARK, 'g'), '')
  return t
    .replace(/(?<=\S)[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Sentences of one line, abbreviation aware. Each piece keeps its trailing whitespace.
const ABBR = /(?:^|\s)(?:[A-Za-z]|e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|st|inc|ltd|no|fig|approx|cf)\.$/i
export function splitSentences(line) {
  const raw = line.match(/[^.!?]*[.!?]+["'”’)\]]*\s*|[^.!?]+$/g) || []
  const out = []
  for (const p of raw) {
    if (out.length && ABBR.test(out[out.length - 1].trimEnd())) out[out.length - 1] += p
    else out.push(p)
  }
  return out
}
