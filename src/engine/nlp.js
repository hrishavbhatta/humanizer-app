// Thin wrappers around compromise (MIT): conjugation, part-of-speech lookups, plural check.
import nlp from 'compromise'
import { PS, PE, QS, QE, MARK } from './util.js'

const confCache = new Map()
const PP_OVERRIDE = { grow: 'grown', choose: 'chosen', know: 'known', show: 'shown', give: 'given', take: 'taken', draw: 'drawn' }

// Forms of an English verb: { inf, pres (3rd person), past, pp, ger }. Multi-word verbs ("find out") conjugate the first word.
export function conjugate(verb) {
  if (confCache.has(verb)) return confCache.get(verb)
  const [head, ...rest] = verb.split(' ')
  const tail = rest.length ? ' ' + rest.join(' ') : ''
  const c = nlp('we ' + head).verbs().conjugate()[0]
  let f = null
  if (c && c.Infinitive && c.PresentTense && c.PastTense && c.Gerund) {
    f = { inf: c.Infinitive + tail, pres: c.PresentTense + tail, past: c.PastTense + tail, pp: (PP_OVERRIDE[head] || c.PastTense) + tail, ger: c.Gerund + tail }
  }
  confCache.set(verb, f)
  return f
}

// Replace placeholders with same-length filler so compromise sees ordinary words and offsets stay put.
function plain(s) {
  return s.replace(new RegExp(`[${PS}${QS}][^${PE}${QE}]*[${PE}${QE}]`, 'g'), (m) => 'x'.repeat(m.length)).replace(new RegExp(MARK, 'g'), ' ')
}

// Tags of the word that starts at text[off] (looked up inside its own sentence).
export function tagsAt(text, off) {
  const lo = Math.max(0, off - 200)
  const before = text.slice(lo, off)
  let cut = 0
  const re = /[.!?]\s+|\n/g
  let m
  while ((m = re.exec(before))) cut = m.index + m[0].length
  const start = lo + cut
  const endRel = text.slice(off, off + 200).search(/[.!?]\s|\n|$/)
  const win = plain(text.slice(start, off + endRel + 1))
  const rel = off - start
  const terms = nlp(win).json({ offset: true }).flatMap((s) => s.terms)
  const hit = terms.find((t) => t.offset && rel >= t.offset.start && rel < t.offset.start + t.offset.length)
  return new Set(hit ? hit.tags : [])
}

// Is the noun phrase plural? true / false, or null when unsure.
const SINGULAR_WORDS = /^(?:everyone|everybody|someone|anyone|nobody|each|one|society|business|government|company|team|family|community|class|public|everything)$/i
const UNSURE_WORDS = /^(?:staff|data|media|police|news|economics|physics|folks)$/i
export function isPluralNP(np) {
  const words = np.trim().toLowerCase().split(/\s+/)
  const head = words[words.length - 1]
  if (/^(?:these|those|many|all|both|most|several|few|some)$/.test(words[0])) return true
  if (words.includes('and')) return true
  if (SINGULAR_WORDS.test(head)) return false
  if (UNSURE_WORDS.test(head)) return null
  const plural = nlp(np).nouns().isPlural().length > 0
  if (!plural && /s$/.test(head) && !/ss$/.test(head)) return null
  return plural
}

// Tense of the first verb in a clause: 'past' | 'present'.
export function clauseTense(clause) {
  // compromise mis-tags many short clauses ("output rose sharply"), so plain markers decide first.
  if (/\b(?:is|are|am|has|have|does|do|remains?|continues?)\b/i.test(clause)) return 'present'
  if (/\b(?:was|were|had|did|rose|fell|grew|began|led|made|saw|took|came|went|became|gave|ran|won|lost|built|held|knew|brought|wrote|spread|left|broke|chose|drove|sold|paid|got|found|kept|set|met|stood|rose)\b/i.test(clause)) return 'past'
  const terms = nlp(plain(clause)).json().flatMap((s) => s.terms)
  return terms.some((t) => t.tags.includes('Verb') && t.tags.includes('PastTense')) ? 'past' : 'present'
}

// Does a verb appear within the first few words of this text (is it a clause with its own predicate)?
export function hasEarlyVerb(text, within = 6) {
  const terms = nlp(plain(text)).json().flatMap((s) => s.terms)
  return terms.slice(0, within).some((t) => t.tags.includes('Verb'))
}

export { nlp }
