// Runs the humanizer on every sample in tests/samples.json, prints before/after with the score change,
// and asserts output invariants. Exits non-zero on any failure.
import { readFileSync } from 'node:fs'
import { humanize } from '../src/humanizer.js'

const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'))
const verbose = !process.argv.includes('--quiet')
let failures = 0
const fail = (name, msg) => {
  failures++
  console.log(`  FAIL [${name}] ${msg}`)
}

// What the engine does to the raw input before anything else (so the checks compare like with like).
const prep = (s) =>
  s
    .normalize('NFKC')
    .replace(/\u200B|\u200C|\u200D|\u200E|\u200F|\u2060|\uFEFF|\u00AD/g, '')
    .replace(/[\u0430\u0441\u0435\u043E\u0440\u0455]/g, (c) => ({ '\u0430': 'a', '\u0441': 'c', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0455': 's' })[c])
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")

const numbersOf = (s) => (s.match(/\d+(?:[.,]\d+)*/g) || []).sort()
const spansOf = (s) => [
  ...(s.match(/`[^`\n]+`/g) || []),
  ...(s.match(/"[^"\n]*"/g) || []),
  ...(s.match(/https?:\/\/[^\s<>]*[^\s<>.,;:!?)"']/g) || []),
  ...(s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []),
]
const doubled = (s) => (s.match(/\b([A-Za-z]+)\s+\1\b/gi) || []).filter((m) => !/^(?:that that|had had)$/i.test(m.replace(/\s+/, ' ')))

function check(name, input, output) {
  const base = prep(input)
  // numbers
  const left = new Map()
  for (const n of numbersOf(base)) left.set(n, (left.get(n) || 0) + 1)
  for (const n of numbersOf(output)) left.set(n, (left.get(n) || 0) - 1)
  for (const [n, v] of left) if (v > 0) fail(name, `number lost: ${n}`)
  // protected spans and quoted text
  for (const s of spansOf(base)) if (!output.includes(s)) fail(name, `protected span changed: ${s}`)
  // doubled words (no more than the input had)
  if (doubled(output).length > doubled(base).length) fail(name, `doubled word: ${doubled(output).join(', ')}`)
  // spacing and punctuation artifacts
  if (/\S {2,}\S/.test(output)) fail(name, 'double space')
  for (const [re, label] of [[/,\./, '",."'], [/(?<!\.)\.\.(?!\.)/, '".."'], [/,,/, '",,"'], [/ [,.;:!?]/, 'space before punctuation'], [/[.!?] [.!?]/, 'empty sentence']]) {
    if (re.test(output) && !re.test(base)) fail(name, `artifact ${label}`)
  }
  // every sentence starts uppercase (list markers, bold marks and headings are skipped)
  const ABBR = /(?:^|\s)(?:[A-Za-z]|e\.g|i\.e|etc|vs|mr|mrs|dr|prof|st|inc|ltd|no)\.$/i
  for (const line of output.split('\n')) {
    const body = line.replace(/^\s*(?:[-*+>]|#{1,6}|\d+[.)])\s+/, '')
    const parts = body.split(/(?<=[.!?]["')\]]*)\s+/)
    let prev = ''
    for (const p of parts) {
      const c = (p.match(/^[^\p{L}\d]*(\p{L})/u) || [])[1]
      if (c && c === c.toLowerCase() && c !== c.toUpperCase() && !ABBR.test(prev) && /^[^\p{L}\d]*\p{L}/u.test(p) && !/^[a-z]+[A-Z]/.test(p)) fail(name, `sentence starts lowercase: "${p.slice(0, 30)}"`)
      prev = p
    }
  }
  // length
  if (output.length > input.length * 1.15) fail(name, `output too long (${output.length} vs ${input.length})`)
}

let totalBefore = 0
let totalAfter = 0
for (const { name, text } of samples) {
  const r = humanize(text)
  console.log(`\n=== ${name} ===  AI-pattern score: ${r.before.score} -> ${r.after.score}`)
  if (verbose) {
    console.log('--- before\n' + text + '\n--- after\n' + r.text)
    console.log('--- changes: ' + (r.changes.map((c) => c.label + (c.n > 1 ? ' x' + c.n : '')).join('; ') || 'none'))
  }
  totalBefore += r.before.score
  totalAfter += r.after.score
  check(name, text, r.text)
  if (r.after.score > r.before.score) fail(name, `score went up (${r.before.score} -> ${r.after.score})`)
  // idempotence: a second pass must keep every invariant and not grow the text
  const r2 = humanize(r.text)
  check(name + ' (2nd pass)', r.text, r2.text)
  if (r2.text.length > r.text.length * 1.02) fail(name, 'second pass grew the text')
  // determinism
  if (humanize(text).text !== r.text) fail(name, 'not deterministic')
  // the engine's own gate agrees: no empty output for non-empty input
  if (!r.text.trim()) fail(name, 'empty output')
}

// The headline sample must change substantially.
const social = humanize(samples.find((s) => s.name === 'social media essay').text)
if (social.changes.length < 5) fail('social media essay', `only ${social.changes.length} kinds of change`)
if (social.after.score > social.before.score - 30) fail('social media essay', 'score did not drop by 30+')

console.log(`\nAverage AI-pattern score: ${(totalBefore / samples.length).toFixed(1)} -> ${(totalAfter / samples.length).toFixed(1)}`)
if (failures) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log(`\nAll ${samples.length} samples passed`)
