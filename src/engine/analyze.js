// Naturalness meter: counts documented AI-prose tells and combines them into a 0-100 "AI-pattern score".
//
// Score formula (0 = no AI tells at all, 100 = saturated):
//   weighted = 10*stockWords + 14*participleTails + 8*nominalizations + 6*formulaicTransitions
//              + 8*copulaAvoidance + 4*emDashes + 15*chatbotPhrases
//   density  = weighted / max(words, 60) * 100             (tells per 100 words, so length does not matter)
//   rhythm   = 12 * average shortfall of sentence-length CV below 0.35, over paragraphs with 4+ sentences
//   contract = 8 * (1 - contraction rate), only when the text has 2+ places that could be contracted
//   score    = clamp(round(min(80, density) + rhythm + contract), 0, 100)
// It measures style habits that research found to differ between chat models and people (participle
// clauses, nominalizations, uniform rhythm, few contractions). It is not a detector score.
import { STOCK, CHATBOT, OFFERS, CONTRACTIONS } from './rules.js'
import { countNominalizations } from './grammar.js'
import { splitSentences, wordCount } from './util.js'
import { cv, CV_TARGET } from './rhythm.js'

const KEYS = STOCK.flatMap((r) => [...r.map.keys()]).map((k) => k.replace(/ /g, '\\s+'))
const EXTRA = ['multifaceted', 'holistic', 'meticulous(?:ly)?', 'cutting-edge', 'game-changer', 'ever-evolving', 'beacon of', 'unlock(?:s|ed|ing)? the', 'harness(?:es|ed|ing)? the', 'elevate[sd]?', 'realm', 'paradigm', 'landscape of']
const STOCK_RE = new RegExp(`\\b(?:${[...KEYS, ...EXTRA].join('|')})\\b`, 'gi')
const PARTICIPLE_RE = /,\s+(?:leading to|resulting in|causing|making|allowing|enabling|creating|giving|providing|helping|ensuring|building|contributing to|driving|boosting|reducing|fostering|promoting|highlighting|underscoring|emphasizing|reflecting|showcasing|symbolizing|encouraging|enhancing|improving|increasing)\b/gi
const TRANSITION_RE = /(?:^|[.!?]["')]*\s+|\n\s*)(?:moreover|furthermore|additionally|in addition|therefore|thus|hence|consequently|as a result|however|in conclusion|overall|ultimately|on the other hand|in summary|to summarize|it is important to note that|it(?:'s| is) worth noting)\b/gi
const COPULA_RE = /\b(?:serves?|served|stands?|stood|acts?|acted|functions?|functioned)\s+as\s+(?:a|an|the|one)\b|\bboasts?\b|\bfeatures an?\b/gi
const CONTRACTED_RE = /\b[A-Za-z]+n't\b|\b(?:it|that|there|he|she|they|we|you|who|what)'(?:s|re|ve|ll|d)\b|\bI'(?:m|ve|ll|d)\b/gi

const count = (s, re) => (s.match(re.global ? re : new RegExp(re.source, re.flags + 'g')) || []).length
const LIST_LINE = /^\s*(?:[-*+>|#]|\d+[.)])\s/

export function analyze(input) {
  const text = String(input ?? '')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
    .replace(/[‘’]/g, "'")
  const words = text.split(/\s+/).filter(Boolean).length

  const counts = {
    stockWords: count(text, STOCK_RE),
    participleTails: count(text, PARTICIPLE_RE),
    nominalizations: countNominalizations(text),
    transitions: count(text, TRANSITION_RE),
    copulaAvoidance: count(text, COPULA_RE),
    emDashes: count(text, /—|\s–\s|\s--\s/g),
    chatbot: [...CHATBOT, ...OFFERS].reduce((n, re) => n + count(text, re), 0),
  }

  // Sentence-length variation, per prose paragraph.
  const paras = text
    .split('\n')
    .filter((l) => l.trim() && !LIST_LINE.test(l))
    .map((l) => splitSentences(l).map(wordCount).filter((n) => n > 0))
  const all = paras.flat()
  const cvs = paras.filter((p) => p.length >= 3).map(cv)
  const sentenceCv = cvs.length ? cvs.reduce((a, b) => a + b, 0) / cvs.length : all.length >= 3 ? cv(all) : null
  const long = paras.filter((p) => p.length >= 4).map((p) => Math.max(0, (CV_TARGET - cv(p)) / CV_TARGET))
  const rhythmShortfall = long.length ? long.reduce((a, b) => a + b, 0) / long.length : 0

  const c = count(text, CONTRACTED_RE)
  const u = CONTRACTIONS.reduce((n, [re]) => n + count(text, re), 0)
  const contractionRate = c + u ? c / (c + u) : null

  const weighted = 10 * counts.stockWords + 14 * counts.participleTails + 8 * counts.nominalizations + 6 * counts.transitions + 8 * counts.copulaAvoidance + 4 * counts.emDashes + 15 * counts.chatbot
  const density = (weighted / Math.max(words, 60)) * 100
  const contract = c + u >= 2 ? 8 * (1 - contractionRate) : 0
  const score = Math.max(0, Math.min(100, Math.round(Math.min(80, density) + 12 * rhythmShortfall + contract)))

  return {
    score,
    words,
    counts,
    sentenceCv: sentenceCv === null ? null : Math.round(sentenceCv * 100) / 100,
    contractionRate: contractionRate === null ? null : Math.round(contractionRate * 100) / 100,
  }
}
