// Stage 3: grammatical tells of chat-model prose (nominalizations, participle tails, "it is essential for
// X to", formulaic transitions, bureaucratic words, intensifiers). Every step works on exact, narrow patterns.
import { MARK, SENT, matchCase, capitalize, lc, wordCount, rewrite } from './util.js'
import { conjugate, tagsAt, isPluralNP, clauseTense } from './nlp.js'
import { LIGHT, INTRANS, NOMINALS, PLAIN_PHRASES, PLAIN_WORDS, PLAIN_VERBS } from './words.js'

const PREPS = new Set(['of', 'to', 'for', 'in', 'on', 'about', 'with', 'from', 'at', 'by', 'into', 'between', 'over', 'against', 'among', 'regarding', 'toward', 'towards', 'under', 'upon', 'across', 'within', 'through', 'during', 'after', 'before'])
const AUX_PREV = /^(?:has|have|had|having|been|be|being|'ve|'d)$/i
const DET = /^(?:a|an|the|this|that|these|those|my|your|his|her|its|our|their|any|each|every|no|some|another|of|in|for|with|by)$/i
const vowelStart = (s) => /^[aeiou]/i.test(s)
const prevWord = (text, i) => (text.slice(Math.max(0, i - 25), i).match(/([A-Za-z']+)\s*$/) || [])[1] || ''
const nextWord = (text, i) => (text.slice(i, i + 25).match(/^\s+([A-Za-z']+)/) || [])[1] || ''

// ---- 3a. Nominalization reversal: "made a decision" -> "decided" ----
const FORM_KEYS = ['inf', 'pres', 'past', 'pp', 'ger']
let nominalRules = null
function getNominalRules() {
  if (nominalRules) return nominalRules
  nominalRules = NOMINALS.map(([lv, noun, verb, drop, keep]) => {
    const forms = LIGHT[lv]
    const alt = [...new Set(forms)].sort((a, b) => b.length - a.length).map((f) => f.replace(/ /g, '\\s+')).join('|')
    const noart = noun[0] === '*'
    const n = (noart ? noun.slice(1) : noun).replace(/ /g, '\\s+')
    const re = new RegExp(`\\b(${alt})\\s+${noart ? '' : '(?:an?|the)\\s+'}${n}\\b(?![-\\w])`, 'gi')
    return { re, forms, verb, drop, keep }
  })
  return nominalRules
}

// Count of nominalization constructions (used by the naturalness meter).
export function countNominalizations(text) {
  return getNominalRules().reduce((n, r) => n + (text.match(r.re) || []).length, 0)
}

function nominalizations(t, add) {
  for (const { re, forms, verb, drop, keep } of getNominalRules()) {
    const vf = conjugate(verb)
    if (!vf) continue
    ;[t] = rewrite(t, re, (m, text) => {
      const form = m[1].toLowerCase().replace(/\s+/g, ' ')
      const prev = prevWord(text, m.index)
      const idx = []
      forms.forEach((f, i) => f === form && idx.push(i))
      if (!idx.length) return null
      const aux = AUX_PREV.test(prev)
      const cat = aux && idx.includes(3) ? 3 : idx.includes(2) && !aux ? 2 : idx[0]
      let end = m.index + m[0].length
      const w = lc(nextWord(text, end))
      if (drop.includes(w)) end += text.slice(end).match(/^\s+[A-Za-z']+/)[0].length
      else if (keep.includes(w)) end += 0
      else if (PREPS.has(w)) return null
      else if (!INTRANS.has(verb)) return null // bare use would leave the verb without its object
      add('Nominalizations reversed')
      return [matchCase(m[0], vf[FORM_KEYS[cat]]), end]
    })
  }
  // "decide about when they work" -> "decide when they work"
  return t.replace(/\b(decid(?:e|es|ed|ing)) about (?=(?:when|where|what|how|whether|which|who|why)\b)/gi, '$1 ')
}

// ---- 3b. Participle tails: ", leading to X." -> ". This can lead to X." ----
const PART = {
  'leading to': ['lead to', 'leads to', 'led to'],
  'resulting in': ['result in', 'results in', 'resulted in'],
  causing: ['cause', 'causes', 'caused'],
  making: ['make', 'makes', 'made'],
  allowing: ['allow', 'allows', 'allowed'],
  enabling: ['enable', 'enables', 'enabled'],
  creating: ['create', 'creates', 'created'],
  giving: ['give', 'gives', 'gave'],
  providing: ['provide', 'provides', 'provided'],
  helping: ['help', 'helps', 'helped'],
  ensuring: ['ensure', 'ensures', 'ensured'],
  building: ['build', 'builds', 'built'],
  'contributing to': ['contribute to', 'contributes to', 'contributed to'],
  driving: ['drive', 'drives', 'drove'],
  boosting: ['boost', 'boosts', 'boosted'],
  reducing: ['reduce', 'reduces', 'reduced'],
}
const PART_RE = new RegExp(`${SENT}([^.!?\\n]*?),\\s+(?:([a-z]+ly)\\s+)?(${Object.keys(PART).join('|')})\\s+([^,;.!?\\n]+)(?=\\.)`, 'gi')
const SUBJECTS = ['This', 'That']

function participleTails(t, add) {
  let n = 0
  return t.replace(PART_RE, (m, head, adv, part, obj) => {
    if (wordCount(head) < 5 || wordCount(obj) < 2) return m
    if (/^\W*(?:i|we|you|he|she|they)\b/i.test(head) || /\b(?:should|must|shall)\b/i.test(head)) return m
    if (/^to\b/i.test(obj) && lc(part) !== 'helping') return m
    const [base, third, past] = PART[lc(part)]
    const modal = (head.match(/\b(can|may|could|might|will|would)\b/i) || [])[1]
    const tensed = modal ? `${lc(modal)} ${adv ? lc(adv) + ' ' : ''}${base}` : `${adv ? lc(adv) + ' ' : ''}${clauseTense(head) === 'past' ? past : third}`
    const verb = tensed
    add('Participle tail split')
    return `${head}. ${SUBJECTS[n++ % SUBJECTS.length]} ${verb} ${obj}`
  })
}

// ---- 3c. "it is essential for users to" -> "users need to" ----
const NEED_ADJ = 'essential|crucial|vital|important|imperative|necessary|critical'
const NEED_FOR = new RegExp(`\\bit is (?:${NEED_ADJ}) for ((?:[a-z][a-z'-]*\\s+){0,4}?[a-z][a-z'-]*) to\\b`, 'gi')
const NEED_PLAIN = /\bit is (?:essential|crucial|important) to\b/gi
const PRONOUN_SUBJ = { me: ['I', 'need'], us: ['we', 'need'], them: ['they', 'need'], him: ['he', 'needs'], her: ['she', 'needs'], you: ['you', 'need'] }

function needTo(t, add) {
  ;[t] = rewrite(t, NEED_FOR, (m) => {
    const np = m[1]
    if (/\b(?:to|not|be|is|are|was|were|that|which|who|there|it|this|or|but|if|when|how|what|why)\b/i.test(np)) return null
    let subj
    let verb
    const pro = PRONOUN_SUBJ[lc(np)]
    if (pro) [subj, verb] = pro
    else {
      const pl = isPluralNP(np)
      if (pl === null) return null
      subj = np
      verb = pl ? 'need' : 'needs'
    }
    const atStart = /^[A-Z]/.test(m[0])
    subj = atStart ? capitalize(subj) : subj
    add('"It is essential" rewritten')
    return [`${subj} ${verb} to`, m.index + m[0].length]
  })
  if (/\byou(?:r|rs|rself)?\b/i.test(t)) {
    t = t.replace(NEED_PLAIN, (m) => (add('"It is essential" rewritten'), matchCase(m, 'you need to')))
  }
  return t
}

// ---- 3d. Transitions at sentence start ----
const DIGITAL_OPENER = new RegExp(`${SENT}(?:in today['’]s|in the|in this|in our)\\s+(?:digital|modern|interconnected|connected|technology-driven|information)\\s+(?:age|world|era|society|landscape),\\s*`, 'gi')

function transitions(t, add) {
  let alt = 0
  return t
    .split(/(\n\s*\n)/)
    .map((p) => {
      if (/^\s*$/.test(p)) return p
      p = p.replace(new RegExp(`${SENT}(?:therefore|thus|hence),\\s*`, 'gi'), () => (add('Transitions simplified'), 'So, '))
      p = p.replace(new RegExp(`${SENT}(?:consequently|as a result),\\s*`, 'gi'), () => (add('Transitions simplified'), alt++ % 2 === 0 ? 'So, ' : MARK))
      p = p.replace(new RegExp(`${SENT}on the other hand,\\s*`, 'gi'), () => (add('Transitions simplified'), 'But '))
      let however = 0
      p = p.replace(new RegExp(`${SENT}however,\\s*`, 'gi'), (m) => {
        if (however++ === 0) return m
        add('Transitions simplified')
        return 'But '
      })
      return p.replace(DIGITAL_OPENER, () => (add('Stock AI words'), MARK))
    })
    .join('')
}

// ---- 3e. Plain-language swaps ----
let plainRules = null
function getPlainRules() {
  if (plainRules) return plainRules
  const rules = []
  const mk = (map, opts = {}, artOk = true) => {
    const keys = [...map.keys()].sort((a, b) => b.length - a.length)
    const startsA = keys.some((k) => /^an?\s/.test(k))
    const useArt = artOk && !startsA
    const alt = keys.map((k) => k.replace(/ /g, '\\s+')).join('|')
    rules.push({ re: new RegExp(`${useArt ? '(\\b(?:a|an)\\s+)?' : '()'}\\b(${alt})\\b`, 'gi'), map, opts })
  }
  for (const [from, to, opts] of [...PLAIN_PHRASES, ...PLAIN_WORDS]) mk(new Map([[from, to]]), opts)
  for (const [from, to, opts = {}] of PLAIN_VERBS) {
    const a = conjugate(from)
    const b = conjugate(to)
    if (!a || !b) continue
    const map = new Map()
    for (const k of opts.only || ['inf', 'pres', 'past', 'ger']) if (!map.has(a[k])) map.set(a[k], b[k])
    mk(map, opts)
  }
  plainRules = rules
  return rules
}

function plainLanguage(t, add) {
  for (const { re, map, opts } of getPlainRules()) {
    ;[t] = rewrite(t, re, (m, text) => {
      const art = m[1]
      const core = m[2]
      const rep = map.get(core.toLowerCase().replace(/\s+/g, ' '))
      if (rep === undefined) return null
      const end = m.index + m[0].length
      const rest = text.slice(end)
      if (opts.ahead && !new RegExp('^(?:' + opts.ahead + ')', 'i').test(rest)) return null
      if (opts.notAhead && new RegExp('^(?:' + opts.notAhead + ')', 'i').test(rest)) return null
      if (opts.notBehind && new RegExp('(?:^|\\s)(?:' + opts.notBehind + ')\\s+$', 'i').test(text.slice(Math.max(0, m.index - 20), m.index))) return null
      if (opts.pos && !tagsAt(text, m.index + (art ? art.length : 0)).has(opts.pos)) return null
      add('Plainer wording')
      const word = matchCase(core, rep)
      return [art ? (art[0] === 'A' ? (vowelStart(rep) ? 'An ' : 'A ') : vowelStart(rep) ? 'an ' : 'a ') + word : word, end]
    })
  }
  return t
}

// ---- 3f. Intensifiers and "impact" ----
const INTENS = /(\b(?:a|an)\s+)?\b(significantly|truly|incredibly|extremely|highly)\s+(?=([a-z][a-z-]*))/gi
const KEEP_AFTER = { significantly: /er$|^(?:more|less|fewer|different|differently)$/i, highly: /^(?:likely|unlikely|recommended|regarded|rated)$/i }

function intensifiers(t, add) {
  ;[t] = rewrite(t, INTENS, (m, text) => {
    const [, art, word, next] = m
    if (KEEP_AFTER[lc(word)]?.test(next)) return null
    const off = m.index + m[0].length
    if (!tagsAt(text, off).has('Adjective')) return null
    add('Intensifiers trimmed')
    const lead = /^[A-Z]/.test(art || word) ? MARK : ''
    if (!art) return [lead, off]
    return [(art[0] === 'A' ? (vowelStart(next) ? 'An ' : 'A ') : vowelStart(next) ? 'an ' : 'a '), off]
  })
  t = t.replace(/\b(?<!statistically\s)significant(?=\s+(?:challenges?|problems?|obstacles?|risks?|concerns?|issues?|difficulties|drawbacks?|threats?)\b)/gi, (m) => (add('Intensifiers trimmed'), matchCase(m, 'real')))
  const hurt = { impact: 'hurt', impacts: 'hurts', impacted: 'hurt', impacting: 'hurting' }
  const help = { impact: 'help', impacts: 'helps', impacted: 'helped', impacting: 'helping' }
  t = t.replace(/\b(negatively|adversely|positively)\s+(impact|impacts|impacted|impacting)\b/gi, (m, adv, v) => {
    add('Intensifiers trimmed')
    return matchCase(m, (lc(adv) === 'positively' ? help : hurt)[lc(v)])
  })
  ;[t] = rewrite(t, /\b(impact|impacts|impacted|impacting)\b/gi, (m, text) => {
    const pw = prevWord(text, m.index)
    const nw = nextWord(text, m.index + m[0].length)
    if (DET.test(pw) || /^(?:on|of|from|in)$/i.test(nw)) return null
    if (!tagsAt(text, m.index).has('Verb')) return null
    add('Intensifiers trimmed')
    return [matchCase(m[0], { impact: 'affect', impacts: 'affects', impacted: 'affected', impacting: 'affecting' }[lc(m[0])]), m.index + m[0].length]
  })
  return t
}

export const GRAMMAR_STEPS = [
  ['nominalizations', nominalizations],
  ['participles', participleTails],
  ['needto', needTo],
  ['transitions', transitions],
  ['plain', plainLanguage],
  ['intensifiers', intensifiers],
]
