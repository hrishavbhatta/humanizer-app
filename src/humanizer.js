// Offline, deterministic, rule-based humanizer. Never invents content.

const MARK = '' // "something was removed here": used to re-capitalize afterwards
const QS = ''
const QE = ''

// Lookbehind: position is at a sentence or paragraph start.
const SENT = '(?<=^|[.!?]["\'”’)\\]]*\\s+|\\n[ \\t]*|\\uE002)'

function matchCase(orig, rep) {
  if (!rep) return rep
  const c = orig[0]
  if (c !== c.toLowerCase() && c === c.toUpperCase()) return rep[0].toUpperCase() + rep.slice(1)
  return rep
}

function protectQuotes(text) {
  const quotes = []
  const sub = (m) => {
    quotes.push(m)
    return QS + (quotes.length - 1) + QE
  }
  const out = text.replace(/"[^"\n]*"/g, sub).replace(/“[^”\n]*”/g, sub)
  return { text: out, quotes }
}

function restoreQuotes(text, quotes) {
  return text.replace(new RegExp(QS + '(\\d+)' + QE, 'g'), (_, i) => quotes[+i])
}

// Build a rule from [source form, replacement] pairs (covers inflections).
function forms(pairs, { suffix = '', guard } = {}) {
  const map = new Map(pairs.map(([a, b]) => [a.toLowerCase(), b]))
  const alt = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/ /g, '\\s+'))
    .join('|')
  return { re: new RegExp(`\\b(?:${alt})\\b${suffix}`, 'gi'), map, guard }
}

const NOUN_LEVERAGE_PREV = /\b(?:the|a|an|of|some|more|no|any|its|their|his|her|our|your|financial|operating|political|much|little|have|has|had|gain|gains|gaining|with|use|using)\s+$/i

const STOCK = [
  forms([['navigate the complexities of', 'handle'], ['navigates the complexities of', 'handles'], ['navigated the complexities of', 'handled'], ['navigating the complexities of', 'handling']]),
  forms([['delve into', 'dig into'], ['delves into', 'digs into'], ['delved into', 'dug into'], ['delving into', 'digging into']]),
  forms([['delve', 'dig'], ['delves', 'digs'], ['delved', 'dug'], ['delving', 'digging']]),
  forms([['utilize', 'use'], ['utilise', 'use'], ['utilizes', 'uses'], ['utilises', 'uses'], ['utilized', 'used'], ['utilised', 'used'], ['utilizing', 'using'], ['utilising', 'using']]),
  forms([['leverage', 'use'], ['leverages', 'uses'], ['leveraged', 'used'], ['leveraging', 'using']], {
    guard: (s, off) => !NOUN_LEVERAGE_PREV.test(s.slice(Math.max(0, off - 20), off)),
  }),
  forms([['facilitate', 'help'], ['facilitates', 'helps'], ['facilitated', 'helped'], ['facilitating', 'helping']]),
  forms([['commence', 'start'], ['commences', 'starts'], ['commenced', 'started'], ['commencing', 'starting']]),
  forms([['endeavor', 'try'], ['endeavors', 'tries'], ['endeavored', 'tried'], ['endeavoring', 'trying'], ['endeavour', 'try'], ['endeavours', 'tries'], ['endeavoured', 'tried']], { suffix: '(?=\\s+to\\b)' }),
  forms([['a plethora of', 'lots of'], ['plethora of', 'lots of']]),
  forms([['a myriad of', 'many'], ['myriad of', 'many']]),
  forms([['a wide range of', 'many']]),
  forms([['a testament to', 'a sign of'], ['testament to', 'sign of']]),
  forms([['tapestry', 'mix']]),
  forms([['a crucial', 'an important'], ['crucial', 'important'], ['pivotal', 'key']]),
  forms([['seamlessly', 'smoothly'], ['seamless', 'smooth']]),
  forms([['robust', 'strong']]),
  forms([['vibrant', 'lively']]),
  forms([['fosters', 'builds'], ['fostered', 'built'], ['fostering', 'building'], ['foster', 'build']], {
    suffix: '(?!\\s+(?:care|parents?|homes?|child|children|famil(?:y|ies)|mother|father|brother|sister))',
  }),
  forms([['embark on', 'start'], ['embarks on', 'starts'], ['embarked on', 'started'], ['embarking on', 'starting']]),
  forms([['in the realm of', 'in']]),
  forms([['boasts', 'has']]),
  forms([['showcases', 'shows'], ['showcased', 'showed'], ['showcasing', 'showing']]),
  forms([['underscores', 'shows'], ['underscored', 'showed'], ['underscoring', 'showing']]),
  forms([['showcase', 'show'], ['underscore', 'show']], { suffix: '(?!\\s+(?:of|for)\\b)' }),
  forms([['garner', 'get'], ['garners', 'gets'], ['garnered', 'got'], ['garnering', 'getting']]),
  forms([['enhance', 'improve'], ['enhances', 'improves'], ['enhanced', 'improved'], ['enhancing', 'improving']]),
  forms([['intricacies', 'details'], ['intricate', 'complex'], ['interplay', 'interaction']]),
]

// §1, §8: "serves as a" / "stands as a" instead of "is a"
const IS_ARE = [
  [/\b(?:serves|stands) as\b(?=\s+(?:a|an|the|one)\b)/gi, 'is'],
  [/\b(?:served|stood) as\b(?=\s+(?:a|an|the|one)\b)/gi, 'was'],
  [/\b(?:serve|stand) as\b(?=\s+(?:a|an|the|one)\b)/gi, 'are'],
]

// §4 sales language
const SALES = [
  [/\bnestled (?:with)?in\b/gi, 'in'],
  [/\bnestled\b\s*/gi, null],
  [/\bin the heart of\b/gi, 'in'],
  [/\b(?:breathtaking|stunning|renowned|must-visit|world-class|groundbreaking)\s+(?=\w)/gi, null],
]

// §9, §21, §22, §27, §28, §33: openers and staged lines removed at sentence start
const STAGED = [
  /(?:let['’]s|let us) (?:dive in|get started|break (?:it|this) down)[.!:]?\s*/gi,
  /here['’]s what you need to know[.!:]\s*/gi,
  /without further ado,\s*/gi,
  /(?:honestly|real talk|let['’]s be honest)[?!:,.]\s*/gi,
  /(?:here['’]s the thing|the thing is)[:,]\s*/gi,
  /look,\s*/gi,
  /(?:at its core|in reality|fundamentally|at the end of the day),\s*/gi,
  /(?:to be clear|don['’]t get me wrong),\s*/gi,
  /as of my (?:last|latest) (?:training|knowledge)(?: update| cutoff)?,\s*/gi,
  /you['’]re absolutely right[.!]\s*/gi,
]

// §20 chatbot offers at the end
const OFFERS = [
  /(?<=^|[.!?]\s+|\s+)(?:would you like|do you want|want) me to [^?\n]*\?[ \t]*/gi,
  /(?<=^|[.!?]\s+|\s+)(?:should I continue|shall I go on)\?[ \t]*/gi,
]

// §25 generic positive endings
const ENDINGS = /(?<=^|[.!?]\s+|\s+)(?:the future (?:looks|is) bright|exciting times (?:lie|are) ahead|this (?:represents|marks) a (?:major |significant |big )?step in the right direction)[^.!?\n]*[.!?][ \t]*/gi

// §24 stacked qualifiers
const QUALIFIERS = [
  [/\b(could|might|may|can) (?:potentially|possibly|arguably)\b/gi, '$1'],
  [/\b(?:potentially|possibly) (could|might|may)\b/gi, '$1'],
]

// Removed only at the start of a sentence; null replacement = remove.
const OPENER = new RegExp(`${SENT}in today['’]s fast-paced world,\\s*`, 'gi')

const FILLER = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\b(?:has|have) the ability to\b/gi, 'can'],
  [/\bhad the ability to\b/gi, 'could'],
  [/\bit is important to note that\s*/gi, null],
  [/\bit['’]s worth noting that\s*/gi, null],
  [/\bit is worth noting that\s*/gi, null],
  [/\bit should be noted that\s*/gi, null],
  [/\bneedless to say,?\s*/gi, null],
]

const CHATBOT = [
  new RegExp(`(?<=^\\s*|\\n[ \\t]*)(?:certainly|sure|of course|absolutely|sure thing)!\\s*`, 'gi'),
  /(?<=^\s*|\n[ \t]*)(?:great|good) question[.!]\s*/gi,
  /(?:\bI )?hope (?:this|that) helps(?: you)?(?: out)?[.!]?[ \t]*/gi,
  /(?:please )?let me know if you (?:have|need|want)[^.!?\n]*[.!?][ \t]*/gi,
  /\bas an ai(?: language model)?,\s*/gi,
  /^\s*here(?:'s|’s| is| are)\b[^:\n]{0,100}:[ \t]*/i,
]

const CONTRACTIONS = [
  [/\bdo not\b(?!\s+only\b)/gi, "don't"],
  [/\bdoes not\b(?!\s+only\b)/gi, "doesn't"],
  [/\bis not\b(?!\s+only\b)/gi, "isn't"],
  [/\bare not\b(?!\s+only\b)/gi, "aren't"],
  [/\bcannot\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/\bit is\b(?=\s+[\w“"])/gi, "it's"],
  [/\bthat is\b(?=\s+[\w“"])/gi, "that's"],
  [/\bthey are\b(?=\s+[\w“"])/gi, "they're"],
  [/\bwe are\b(?=\s+[\w“"])/gi, "we're"],
  [/\byou are\b(?=\s+[\w“"])/gi, "you're"],
  [/\bI am\b(?=\s+[\w“"])/g, "I'm"],
]

const wordCount = (s) => s.split(/\s+/).filter((w) => w.replace(//g, '')).length

function longSentences(text) {
  let n = 0
  const out = text.split('\n').map((line) => {
    const pieces = line.match(/[^.!?]*[.!?]+["'”’)\]]*\s*|[^.!?]+$/g)
    if (!pieces) return line
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
  return { text: out.join('\n'), n }
}

export function humanize(input) {
  const tally = new Map()
  const add = (label, n = 1) => tally.set(label, (tally.get(label) || 0) + n)

  const { text: protectedText, quotes } = protectQuotes(String(input ?? ''))
  let t = protectedText

  // Chatbot artifacts
  for (const re of CHATBOT) t = t.replace(re, () => (add('Chatbot artifacts'), MARK))
  for (const re of OFFERS) t = t.replace(re, () => (add('Chatbot artifacts'), MARK))

  // Staged openers, announcements, fake candor
  for (const re of STAGED) {
    t = t.replace(new RegExp(SENT + re.source, re.flags), () => (add('Staged openers'), MARK))
  }

  // Inflated "serves as" verbs
  for (const [re, rep] of IS_ARE) t = t.replace(re, (m) => (add('Avoiding is/are'), matchCase(m, rep)))

  // Qualifier stacks
  for (const [re, rep] of QUALIFIERS) t = t.replace(re, (m, v) => (add('Too many qualifiers'), matchCase(m, rep.replace('$1', v.toLowerCase()))))

  // Filler phrases
  for (const [re, rep] of FILLER) {
    t = t.replace(re, (m) => {
      add('Filler phrases')
      return rep === null ? MARK : matchCase(m, rep)
    })
  }

  // Stock AI words
  t = t.replace(OPENER, () => (add('Stock AI words'), MARK))
  for (const { re, map, guard } of STOCK) {
    t = t.replace(re, (m, ...rest) => {
      const str = rest[rest.length - 1]
      const off = rest[rest.length - 2]
      if (guard && !guard(str, off)) return m
      const rep = map.get(m.toLowerCase().replace(/\s+/g, ' '))
      if (rep === undefined) return m
      add('Stock AI words')
      return matchCase(m, rep)
    })
  }

  // Transition overuse (alternate "Also," and removal)
  let i = 0
  t = t.replace(new RegExp(`${SENT}(?:furthermore|moreover|additionally|in addition),\\s*`, 'gi'), () => {
    add('Transition overuse')
    return i++ % 2 === 0 ? 'Also, ' : MARK
  })
  t = t.replace(new RegExp(`${SENT}(?:in conclusion|overall|ultimately),\\s*`, 'gi'), () => {
    add('Transition overuse')
    return MARK
  })

  // Em dashes, spaced en dashes and double hyphens (en dashes in number ranges stay)
  t = t.replace(/([^\s—])[ \t]*—[ \t]*(?=[^\s—])/g, (_, a) => (add('Em dashes'), a + ', '))
  t = t.replace(/(\S)[ \t]+(?:–|--)[ \t]+(?=\S)/g, (_, a) => (add('Em dashes'), a + ', '))

  // Sales language
  for (const [re, rep] of SALES) t = t.replace(re, (m) => (add('Sales language'), rep === null ? '' : matchCase(m, rep)))

  // Generic positive endings
  t = t.replace(ENDINGS, () => (add('Generic endings'), MARK))

  // Bold text and decorative emojis
  t = t.replace(/\*\*([^*\n]+)\*\*/g, (_, s) => (add('Bold / emojis'), s))
  t = t.replace(/(?<=^|\n)([ \t]*(?:[-*] )?)\p{Extended_Pictographic}️?[ \t]*/gu, (_, p) => (add('Bold / emojis'), p))

  // Not only ... but also ...
  t = t.replace(
    /\bnot only (?!(?:does|do|did|is|are|was|were|can|could|will|would|has|have|had)\b)([^,.;!?\n]+?),?\s+but also ([^.;!?\n]+)/gi,
    (m, x, y) => {
      add('Not only / but also')
      return matchCase(m, `${x} and ${y}`)
    },
  )

  for (const [re, rep] of CONTRACTIONS) {
    t = t.replace(re, (m) => (add('Contractions'), matchCase(m, rep)))
  }

  const r = longSentences(t)
  t = r.text
  if (r.n) add('Long sentences split', r.n)

  // Final cleanup
  t = t.replace(/([ \t]*)+/g, MARK)
  t = t.replace(/(^\s*|[.!?]["'”’)\]]*[ \t]+|\n[ \t]*)([a-z])/g, (_, p, c) => p + c.toUpperCase())
  t = t.replace(//g, '')
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  t = restoreQuotes(t, quotes)

  // §19 curly quotes to straight
  t = t.replace(/[“”]/g, () => (add('Curly quotes'), '"')).replace(/(?<=\w)’(?=\w)|[‘’]/g, "'")

  return { text: t, changes: [...tally].map(([label, n]) => ({ label, n })) }
}
