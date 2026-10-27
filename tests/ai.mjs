// Tests for the pure parts of the on-device AI rewrite (src/ai/core.js): chunking, reply cleanup, validation.
import { readFileSync } from 'node:fs'
import { segment, cleanOutput, validate, buildPrompt } from '../src/ai/core.js'

const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'))
let failures = 0
const expect = (cond, msg) => {
  if (!cond) {
    failures++
    console.log('  FAIL ' + msg)
  }
}

// 1. Segmentation is lossless and keeps structure and quotes away from the model.
for (const { name, text } of samples) {
  const segs = segment(text)
  expect(segs.map((s) => s.text).join('') === text, `[${name}] segments do not join back to the input`)
  for (const s of segs.filter((x) => !x.keep)) {
    expect(!/["“”`]|https?:\/\//.test(s.text), `[${name}] chunk contains a quote/code/link: ${s.text.slice(0, 40)}`)
    expect(!/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(s.text), `[${name}] chunk is a heading or list item`)
    expect(!s.text.includes('\n'), `[${name}] chunk spans lines`)
    expect(s.text.split(/\s+/).length <= 75, `[${name}] chunk too long`)
  }
}
const md = segment('# Title\n\nThis is a long enough paragraph of prose that goes to the model. It has two sentences.\n\n- first item in the list that is long enough to count\n- second')
expect(md.filter((s) => !s.keep).length === 1, 'markdown: only the prose paragraph should be a chunk')
const dlg = segment('She looked up and said, "We should leave now." Then she walked out of the room without another word to anyone.')
expect(dlg.some((s) => s.keep && s.text.includes('"We should leave now."')), 'dialogue sentence must be kept')

// 2. Reply cleanup.
const src = 'The committee reached a decision on 12 March. Dr. Smith was pleased with it.'
expect(cleanOutput('Here is the rewritten text:\n\nThe committee decided on 12 March.', src) === 'The committee decided on 12 March.', 'preamble not stripped')
expect(cleanOutput('"The committee decided on 12 March."', src) === 'The committee decided on 12 March.', 'wrapping quotes not stripped')
expect(cleanOutput('Sure! Here\'s a version: The committee decided.<|im_end|>', src) === 'The committee decided.', 'sure/chat token not stripped')
expect(cleanOutput('The committee decided.\n\nNote: I kept the date.', src) === 'The committee decided.', 'trailing note not stripped')

// 3. Validator accepts good rewrites and rejects the failures we care about.
const good = 'The committee decided on 12 March, and Dr. Smith was happy with the outcome.'
expect(validate(src, good).ok, 'good rewrite rejected: ' + validate(src, good).reason)
expect(!validate(src, 'The committee decided in March, and Dr. Smith was happy about it.').ok, 'dropped number accepted')
expect(!validate(src, 'The committee decided on 12 March, and Dr. Jones was happy with the outcome.').ok, 'dropped name accepted')
expect(!validate(src, 'Okay.').ok, 'too short accepted')
expect(!validate(src, good + ' ' + good + ' ' + good).ok, 'too long accepted')
expect(!validate(src, 'Here is a rewritten version: ' + good).ok, 'chatter accepted')
expect(!validate(src, 'The committee decided on 12 March and Dr. Smith was happy with the').ok, 'cut-off accepted')
expect(!validate(src, '委员会在 12 March 做出了决定, and Dr. Smith was happy with the outcome.').ok, 'foreign characters accepted')
expect(!validate(src, 'The committee decided on 12 March. The committee decided on 12 March. The committee decided on 12 March. Dr. Smith.').ok, 'repetition accepted')
expect(validate(src, src).ok, 'identical text should pass (it is simply unchanged)')

// 4. Prompt shape.
const p = buildPrompt('Hello there.')
expect(p.startsWith('<|im_start|>system') && p.endsWith('<|im_start|>assistant\n') && p.includes('Hello there.'), 'prompt is not ChatML')

console.log(failures ? `\nai tests: ${failures} failure(s)` : 'ai tests: all passed')
process.exit(failures ? 1 : 0)
