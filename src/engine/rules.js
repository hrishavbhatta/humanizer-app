// Stage 2: the original deletion / swap rules (chatbot artifacts, filler, stock words, staged openers, sales
// language ...). Each step is a function (text, add) => text, run behind the quality gate in index.js.
import { MARK, SENT, matchCase, lc, wordCount } from './util.js'

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

const HL_BLOCK_PREV = /\b(?:a|an|the|of|its|their|his|her|our|your|my|key|main|major|top|best|these|those|this|that|many|some|all|other|several|few|recent|new|notable|was|were|is|are|be|been|being|has|have|had)\s+$/i

export const STOCK = [
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
  forms([['the plethora of', 'the many'], ['a plethora of', 'lots of'], ['plethora of', 'lots of']]),
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
  forms([['an enduring', 'a lasting'], ['enduring', 'lasting']]),
  forms([['align with', 'match'], ['aligns with', 'matches'], ['aligned with', 'matched'], ['aligning with', 'matching']]),
  forms([['highlights', 'shows'], ['highlighted', 'showed'], ['highlighting', 'showing'], ['highlight', 'show']], {
    suffix: '(?=\\s+(?:the|an?|its|their|his|her|our|your|how|that|why|what|this|these|those|both|several|many|some|key|major|important)\\b)',
    guard: (s, off, m) => !/^[A-Z]/.test(m) && !HL_BLOCK_PREV.test(s.slice(Math.max(0, off - 15), off)),
  }),
  forms([['intricacies', 'details'], ['intricate', 'complex'], ['interplay', 'interaction']]),
]

// §1, §8: "serves as a" / "stands as a" instead of "is a"
export const IS_ARE = [
  [/\b(?:serves|stands) as\b(?=\s+(?:a|an|the|one)\b)/gi, 'is'],
  [/\b(?:served|stood) as\b(?=\s+(?:a|an|the|one)\b)/gi, 'was'],
  [/\b(?:serve|stand) as\b(?=\s+(?:a|an|the|one)\b)/gi, 'are'],
]

// §4 sales language
const SALES = [
  [/\bnestled (?:with)?in\b/gi, 'in'],
  [/\bnestled\b\s*/gi, null],
  [/\bin the heart of\b/gi, 'in'],
  [/\brich cultural heritage\b/gi, 'cultural heritage'],
]
// Adjective removal; fixes the a/an before the next word ("a profound effect" -> "an effect").
const SALES_ADJ = /(?:\b(an?)\s+)?\b(?:breathtaking|stunning|renowned|must-visit|world-class|groundbreaking|profound)\s+(?=(\w))/gi

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
  /(?:up to|as of) my (?:last (?:training|knowledge) update|knowledge cutoff),\s*/gi,
  /actually,\s*/gi,
  /despite these challenges,\s*/gi,
  /that['’]s an excellent point[^.!?\n]*[.!]\s*/gi,
  /(?:what a great|excellent) question[.!]\s*/gi,
  /(?:heads up|quick note):\s*/gi,
  /before i forget,\s*/gi,
  /(?:now,? )?let['’]s (?:explore|take a look)[.!]\s*/gi,
]

// §20 chatbot offers at the end
export const OFFERS = [
  /(?<=^|[.!?]\s+|\s+|\s*)(?:would you like|do you want|want) me to [^?\n]*\?[ \t]*/gi,
  /(?<=^|[.!?]\s+|\s+|\s*)(?:should I continue|shall I go on)\?[ \t]*/gi,
]

// §25 generic positive endings
const ENDINGS = /(?<=^|[.!?]\s+|\s+|\s*)(?:the future (?:looks|is) bright|exciting times (?:lie|are) ahead|this (?:represents|marks) a (?:major |significant |big )?step in the right direction)[^.!?\n]*[.!?][ \t]*/gi

// §24 stacked qualifiers
const QUALIFIERS = [
  [/\b(could|might|may|can) (?:potentially|possibly|arguably)\b/gi, '$1'],
  [/\b(?:potentially|possibly) (could|might|may)\b/gi, '$1'],
]

// Removed only at the start of a sentence.
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
  [/\bit could be argued that\s*/gi, null],
]

export const CHATBOT = [
  new RegExp(`(?<=^\\s*|\\n[ \\t]*)(?:certainly|sure|of course|absolutely|sure thing)!\\s*`, 'gi'),
  /(?<=^\s*|\n[ \t]*)(?:great|good) question[.!]\s*/gi,
  /(?:\bI )?hope (?:this|that) helps(?: you)?(?: out)?[.!]?[ \t]*/gi,
  /(?:please )?let me know if you (?:have|need|want)[^.!?\n]*[.!?][ \t]*/gi,
  /\bas an ai(?: language model)?,\s*/gi,
  /^\s*here(?:'s|’s| is| are)\b[^:\n]{0,100}:[ \t]*/i,
]

// ---- Sentence-level removals (whole sentences) ----
const END_PUNCT = '[.!?]+["\'”’)\\]]*[ \\t]*'
const dropContaining = (inner) => new RegExp(SENT + '[^.!?\\n]*(?:' + inner + ')[^.!?\\n]*' + END_PUNCT, 'gi')
const dropStarting = (inner) => new RegExp(SENT + '(?:' + inner + ')[^.!?\\n]*' + END_PUNCT, 'gi')

const SENTENCE_DROPS = [
  ['Name-dropping', dropContaining('active social media presence')], // §2
  ['Vague sources', dropStarting('(?:experts|observers|critics|some critics|industry reports|several sources|many experts)\\s+(?:believe|argue|say|suggest|note|have noted|have cited|claim)\\b')], // §5
  ['Challenges / outlook', dropContaining('continues to thrive')], // §6
  ['Knowledge-limit text', dropContaining('maintains a low profile|keeps (?:his|her|their) personal (?:details|life) private|prefers to stay out of the spotlight|not extensively documented in readily available sources')], // §21
  ['Generic endings', dropContaining('journey toward excellence')], // §25
  ['Generic endings', dropStarting('exciting times')], // §25
]

// ---- Trailing clauses (§1 inflated importance, §3 shallow -ing tails) ----
const SKIP_TAIL = /;|,\s+(?:and|but|while|yet)\s+(?:he|she|it|they|we|you|I|there)\b/i
const IMPORTANCE_LEAD = 'marking an? (?:pivotal|significant|key|major) (?:moment|shift|turning point|milestone)|setting the stage for|contributing to the|reflecting (?:an? |the )?broader|symbolizing its (?:ongoing|enduring|lasting)|(?:underscoring|highlighting|emphasizing) (?:its|the|their) (?:importance|significance)'
// Only tails with an abstract, fact-free object are cut; "symbolizing Texas bluebonnets" keeps its facts.
const ING_LEAD =
  "(?:highlighting|underscoring|emphasizing|reflecting|symbolizing|showcasing) (?:its |the |their |a |an )?(?:\\w+['’]s )?(?:(?:deep|rich|strong|enduring|lasting|ongoing|broader|unwavering|profound) )*(?:importance|significance|commitment|dedication|connection|legacy|heritage|values?|spirit|essence|passion)\\b" +
  '|(?:fostering|cultivating) (?:a |an )?(?:(?:strong|deep|lasting|vibrant) )*(?:sense of )?(?:community|belonging|collaboration|innovation|connection|unity|inclusivity)\\b'

function trimTails(text, lead, minHead, minTail, onHit) {
  // The tail must be the sentence's last clause, so a later clause with real content is never cut.
  const re = new RegExp(SENT + '([^.!?\\n]*?)(,\\s+(?:' + lead + ')\\b[^,;.!?\\n]*)(?=[.!?])', 'gi')
  return text.replace(re, (m, head, tail) => {
    if (wordCount(head) < minHead || wordCount(tail) < minTail || SKIP_TAIL.test(tail)) return m
    onHit()
    return head
  })
}

// ---- Phrase rewrites ----
const ROLE_AUX = /^(?:to|will|would|can|could|may|might|must|should|shall|continue|continues|continued|does|do|did)$/
const ROLE_PLURAL = /^(?:they|we|you|these|those|people|children|men|women|[a-z]+[^s\W]s|[a-z]*[^su\W]s)$/

// "plays a crucial role in" -> "is important in", keeping tense; skipped when the subject is unclear.
function roleRewrite(m, verb, prep, off, str) {
  const before = str.slice(Math.max(0, off - 40), off)
  if (/\band\b/i.test(before.split(/[.!?]/).pop())) return null
  const pw = lc((before.match(/([A-Za-z’']+)\s+$/) || [])[1] || '')
  const v = lc(verb)
  let aux = null
  if (v === 'plays') aux = 'is'
  else if (v === 'playing') aux = 'being'
  else if (v === 'played') aux = /^(?:has|have|had)$/.test(pw) ? 'been' : ROLE_PLURAL.test(pw) ? 'were' : pw ? 'was' : null
  else if (v === 'play') aux = ROLE_AUX.test(pw) ? 'be' : pw === 'i' ? 'am' : ROLE_PLURAL.test(pw) ? 'are' : null
  if (!aux) return null
  return matchCase(m, aux + ' important ' + prep)
}

const HYPHEN_ADJ = 'high-quality|data-driven|cross-functional|client-facing|well-known|real-time|long-term|end-to-end|third-party|decision-making'
const HYPHEN_AFTER_VERB = new RegExp(
  '\\b(is|are|was|were|be|been|being|seems|looks) (' + HYPHEN_ADJ + ')(?=[ \\t]*(?:[,.;:!?)\\n]|$)|\\s+(?:and|but|or|so|yet|enough|to|for|because|while|when|if)\\b)',
  'gi',
)

const PHRASES = [
  ['Inflated importance', /\bthe evolving landscape of\s+/gi, (m) => (/^[A-Z]/.test(m) ? MARK : '')],
  [
    'Inflated importance',
    /\b(left|leaves|leave|leaving) an indelible mark on\b/gi,
    (m, v) => matchCase(m, { left: 'influenced', leaves: 'influences', leave: 'influence', leaving: 'influencing' }[lc(v)]),
  ],
  ['Inflated importance', /\b(plays|played|playing|play) an? (?:vital|crucial|pivotal|key|significant) role (in|for)\b/gi, (m, v, p, off, str) => roleRewrite(m, v, p, off, str)],
  ['Authority tropes', /\bthe real question is\b/gi, (m) => matchCase(m, 'the question is')],
  ['Authority tropes', /\bwhat really matters is\b/gi, (m) => matchCase(m, 'what matters is')],
  ['Authority tropes', /\bthe deeper issue is\b/gi, (m) => matchCase(m, 'the issue is')],
  ['Authority tropes', /\bthe heart of the matter is\b/gi, (m) => matchCase(m, 'the point is')],
  ['Hyphenated pairs', HYPHEN_AFTER_VERB, (m, v, c) => v + ' ' + c.replace(/-/g, ' ')],
  [
    'Avoiding is/are',
    /\bfeatures (an?)\b/gi,
    (m, art, off, str) => (/\b(?:the|its|their|key|main|new|these|those|all|other|top|many|some|few|several|core|best|and|of|with|no|any|two|three|more)\s+$/i.test(str.slice(Math.max(0, off - 12), off)) ? null : matchCase(m, 'has ' + art)),
  ],
  // §9 negative parallelism: keep only the second clause
  [
    'Negative parallelism',
    /\b(?:it['’]s|it is|this is|that['’]s|that is) not (?:just|merely|only|simply)\b[^.!?;\n]*?[,;]\s*(it['’]s|it is|this is|that['’]s|that is)\s+([^.!?\n]+)/gi,
    (m, subj, y) => matchCase(m, lc(subj) + ' ' + y),
  ],
  [
    'Negative parallelism',
    /\b(is|are) not (?:just|merely|simply) [^,.;!?\n]+?[,;]\s+(?:it['’]s|it is|they['’]re|they are) (?=(?:an?|the)\b)/gi,
    (m, v) => v + ' ',
  ],
  ['Negative parallelism', /,\s+no (?:guessing|fuss|hassle|questions asked)(?=[.!?])/gi, () => ''],
]

// Steps, in order. Each is one quality-gated unit.
export const STEPS = [
  [
    'chatbot',
    (t, add) => {
      for (const re of CHATBOT) t = t.replace(re, () => (add('Chatbot artifacts'), MARK))
      for (const re of OFFERS) t = t.replace(re, () => (add('Chatbot artifacts'), MARK))
      return t
    },
  ],
  [
    'staged',
    (t, add) => {
      for (const re of STAGED) t = t.replace(new RegExp(SENT + re.source, re.flags), () => (add('Staged openers'), MARK))
      return t
    },
  ],
  [
    'drops',
    (t, add) => {
      for (const [label, re] of SENTENCE_DROPS) t = t.replace(re, () => (add(label), MARK))
      return t
    },
  ],
  [
    'dashes',
    (t, add) => {
      // Em dashes, spaced en dashes and double hyphens (en dashes in number ranges stay)
      t = t.replace(/([^\s—])[ \t]*—[ \t]*(?=[^\s—])/g, (_, a) => (add('Em dashes'), a + ', '))
      t = t.replace(/(\S)[ \t]+(?:–|--)[ \t]+(?=\S)/g, (_, a) => (add('Em dashes'), a + ', '))
      return t.replace(/(?<=[a-z])–(?=[a-z])/g, () => (add('Em dashes'), ', '))
    },
  ],
  [
    'tails',
    (t, add) => {
      t = trimTails(t, IMPORTANCE_LEAD, 3, 3, () => add('Inflated importance'))
      return trimTails(t, ING_LEAD, 5, 3, () => add('Shallow -ing tails'))
    },
  ],
  [
    'phrases',
    (t, add) => {
      for (const [label, re, fn] of PHRASES) {
        t = t.replace(re, (...a) => {
          const r = fn(...a)
          if (r === null || r === undefined) return a[0]
          add(label)
          return r
        })
      }
      for (const [re, rep] of IS_ARE) t = t.replace(re, (m) => (add('Avoiding is/are'), matchCase(m, rep)))
      for (const [re, rep] of QUALIFIERS) t = t.replace(re, (m, v) => (add('Too many qualifiers'), matchCase(m, rep.replace('$1', v.toLowerCase()))))
      return t
    },
  ],
  [
    'filler',
    (t, add) => {
      for (const [re, rep] of FILLER) {
        t = t.replace(re, (m) => {
          add('Filler phrases')
          return rep === null ? MARK : matchCase(m, rep)
        })
      }
      return t
    },
  ],
  [
    'stock',
    (t, add) => {
      t = t.replace(OPENER, () => (add('Stock AI words'), MARK))
      for (const { re, map, guard } of STOCK) {
        t = t.replace(re, (m, ...rest) => {
          const str = rest[rest.length - 1]
          const off = rest[rest.length - 2]
          if (guard && !guard(str, off, m)) return m
          const rep = map.get(m.toLowerCase().replace(/\s+/g, ' '))
          if (rep === undefined) return m
          add('Stock AI words')
          return matchCase(m, rep)
        })
      }
      return t
    },
  ],
  [
    'transitions',
    (t, add) => {
      // Transition overuse (alternate "Also," and removal)
      let i = 0
      t = t.replace(new RegExp(`${SENT}(?:furthermore|moreover|additionally|in addition),\\s*`, 'gi'), () => {
        add('Transition overuse')
        return i++ % 2 === 0 ? 'Also, ' : MARK
      })
      return t.replace(new RegExp(`${SENT}(?:in conclusion|overall|ultimately),\\s*`, 'gi'), () => {
        add('Transition overuse')
        return MARK
      })
    },
  ],
  [
    'sales',
    (t, add) => {
      t = t.replace(SALES_ADJ, (m, art, nxt) => {
        add('Sales language')
        if (art) return matchCase(art, /[aeiou]/i.test(nxt) ? 'an' : 'a') + ' '
        return /^[A-Z]/.test(m) ? MARK : ''
      })
      for (const [re, rep] of SALES) t = t.replace(re, (m) => (add('Sales language'), rep === null ? '' : matchCase(m, rep)))
      return t.replace(ENDINGS, () => (add('Generic endings'), MARK))
    },
  ],
  [
    'format',
    (t, add) => {
      // Bold text and decorative emojis
      t = t.replace(/\*\*([^*\n]+)\*\*/g, (_, s) => (add('Bold / emojis'), s))
      t = t.replace(/(?<=^|\n)([ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)?)(?:\p{Extended_Pictographic}[\uFE0F\u200D]*[ \t]*)+/gu, (_, p) => (add('Bold / emojis'), p))
      // §17 Title Case headings -> sentence case
      t = t.replace(/^(#{1,6}[ \t]+)(.+)$/gm, (m, mark, body) => {
        const words = body.trim().split(/\s+/)
        if (words.length < 3) return m
        const long = words.filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3)
        if (!long.length || !long.every((w) => /^[^\p{L}]*\p{Lu}/u.test(w))) return m
        const out = words.map((w, i) => {
          const letters = w.replace(/[^\p{L}]/gu, '')
          if (i === 0 || /\d/.test(w) || (letters.length >= 2 && letters === letters.toUpperCase()) || /\p{Lu}/u.test(w.slice(1))) return w
          return w.toLowerCase()
        })
        const res = mark + out.join(' ')
        if (res === m) return m
        add('Heading case')
        return res
      })
      // Not only ... but also ...
      return t.replace(
        /\bnot only (?!(?:does|do|did|is|are|was|were|can|could|will|would|has|have|had)\b)([^,.;!?\n]+?),?\s+but also ([^.;!?\n]+)/gi,
        (m, x, y) => {
          add('Not only / but also')
          return matchCase(m, `${x} and ${y}`)
        },
      )
    },
  ],
]

// ---- Stage 4: contractions ----
const NOT_ONLY = '(?!\\s+(?:only|just)\\b)'
export const CONTRACTIONS = [
  [/\bdo not\b(?!\s+only\b)/gi, "don't"],
  [/\bdoes not\b(?!\s+only\b)/gi, "doesn't"],
  [/\bdid not\b(?!\s+only\b)/gi, "didn't"],
  [/\bis not\b(?!\s+only\b)/gi, "isn't"],
  [/\bare not\b(?!\s+only\b)/gi, "aren't"],
  [new RegExp(`\bwas not\b${NOT_ONLY}`, 'gi'), "wasn't"],
  [new RegExp(`\bwere not\b${NOT_ONLY}`, 'gi'), "weren't"],
  [new RegExp(`\bhave not\b${NOT_ONLY}`, 'gi'), "haven't"],
  [new RegExp(`\bhas not\b${NOT_ONLY}`, 'gi'), "hasn't"],
  [new RegExp(`\bwould not\b${NOT_ONLY}`, 'gi'), "wouldn't"],
  [new RegExp(`\bcould not\b${NOT_ONLY}`, 'gi'), "couldn't"],
  [new RegExp(`\bshould not\b${NOT_ONLY}`, 'gi'), "shouldn't"],
  [/\bcannot\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/(?<!\bof\s)\bit is\b(?=\s+[\w“"])/gi, "it's"],
  [/(?<!\bof\s)\bthat is\b(?=\s+[\w“"])/gi, "that's"],
  [/\bthere is\b(?=\s+[\w“"])/gi, "there's"],
  [/\bthey are\b(?=\s+[\w“"])/gi, "they're"],
  [/\bwe are\b(?=\s+[\w“"])/gi, "we're"],
  [/\byou are\b(?=\s+[\w“"])/gi, "you're"],
  [/\bI am\b(?=\s+[\w“"])/g, "I'm"],
]

export function contractions(t, add) {
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, (m) => (add('Contractions'), matchCase(m, rep)))
  return t
}
