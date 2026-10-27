# Humanizer

Rewrites AI-sounding text so it reads like a person wrote it, without changing the meaning.
It runs fully offline: there is no server, no account and no API key. Your text never leaves the device.

The same code ships as a web app and as an Android app (built with Capacitor).

## How it works

The engine lives in `src/engine/` (`src/humanizer.js` re-exports it). It is deterministic and rule-based: the same
text always gives the same result, nothing is invented, and nothing leaves the device. It follows the checklist in
`src/humanizer-skill.md` (based on Wikipedia's "Signs of AI writing") and goes further, because chat-model prose
differs from human prose mostly in grammar, not just vocabulary. The "What changed" list shows which rules fired.

### Pipeline

Every stage runs behind a quality gate: the text is snapshotted before the stage and validated after it. If a
protected span went missing, a word was doubled, a sentence emptied, punctuation broke (`" ,"`, `",,"`, `".."`)
or quotes and brackets stopped balancing, that stage is discarded and the text stays as it was.

| Stage | File | What it does |
|---|---|---|
| 0 Clean input | `index.js` | Unicode NFKC, strips zero-width and other hidden characters, maps Cyrillic/Greek look-alike letters inside Latin words back to ASCII, straightens curly quotes |
| 1 Protect spans | `index.js` | Quotes, `backtick code`, URLs, emails and numbers with units or percentages are swapped for placeholders and restored at the end. After the whole pipeline every protected span and every number must still be there |
| 2 Rules | `rules.js` | Chatbot artifacts, staged openers, filler, stock AI words, sales language, vague sources, "serves as", em dashes, "not only ... but also", bold and emojis, Title Case headings |
| 3 Grammar tells | `grammar.js`, `words.js` | Nominalizations ("made a decision" to "decided", 90+ curated phrases, tense kept with compromise), participle tails (", leading to X." becomes "This can lead to X."), "it is essential for users to" to "users need to", transitions (Therefore to So, extra However to But), ~130 plain-language swaps, intensifier trimming, "negatively impact" to "hurt" |
| 4 Contractions | `rules.js` | do not to don't, it is to it's and similar |
| 5 Rhythm | `rhythm.js` | If a paragraph of 4+ sentences has a sentence-length variation (stdev / mean) below 0.35, merges a pair of short sentences or splits the longest one (at most 2 changes, each kept only if it raises the variation). Also breaks up 3 sentences in a row that start with the same word |
| 6 Cleanup | `util.js`, `index.js` | Spacing, punctuation, capitalization, final validation |

The grammar rules only fire on exact, curated patterns. Anything that needs judgment (plural or adjective-modified
nominals such as "make informed decisions", agent participles such as "She smiled, giving him a nod") is left alone.
It never adds typos, look-alike characters or invisible characters: it is a readability editor, not a detector bypass.

Covered by the checklist rules (fully or in part): chatbot artifacts and offers (§20), inflated importance and
trailing clauses (§1), name-dropping (§2), shallow "-ing" tails (§3), sales language (§4), vague sources (§5),
challenges/outlook boilerplate (§6), stock AI words (§7), avoiding "is/are" (§8), negative parallelisms
and clipped negation (§9), em/en dashes (§14), Title Case headings (§17), emojis and bold (§18),
curly quotes (§19), knowledge-limit text (§21), sycophancy (§22), "not only ... but also" and filler,
stacked hedging (§24), generic endings (§25), hyphenated pairs after a verb (§26), authority tropes (§27),
signposting (§28), contractions and long-sentence splitting.

Not automated, because they need judgment about meaning or voice: §10, §11, §12, §13, §29, §30, §31, §32, §35.
Also skipped on purpose: §34 ("This is not to say that ..."), since dropping it would flip the meaning.

### Naturalness meter

`analyze(text)` (`src/engine/analyze.js`) counts the tells research found to separate chat-model prose from human
prose: stock AI words, participle tails, nominalizations, formulaic transitions, "serves as" copula avoidance, em dashes,
chatbot phrases, plus sentence-length variation and contraction rate. They combine into a 0-100 "AI-pattern score"
(0 = no tells; the weighted formula is documented at the top of the file). The app shows it under the output as
"AI-pattern score: 72 → 28". It measures style habits only; it is not a detector score and says nothing about how any
specific detector will rate the text.

### Dependencies

Part-of-speech tagging and verb conjugation use [compromise](https://github.com/spencermountain/compromise) (MIT),
bundled and fully offline. It adds about 380 kB (160 kB gzipped) to the app bundle. The plain-language word list
follows plainlanguage.gov "Simple Words and Phrases" (US federal work, public domain) and retext-simplify (MIT).

### Tests

```
npm test
```

runs the engine on the realistic ChatGPT-style paragraphs in `tests/samples.json` (school essay, email, product page,
cover letter, quoted dialogue, markdown list, text with URLs and hidden characters, and more), prints before and after
with the score change, and checks the invariants: every number and protected span survives, quoted text is identical,
no doubled words, double spaces or `",."` / `".."` artifacts, every sentence starts with a capital, the output is at
most 15% longer, a second pass breaks nothing, and the result is deterministic. It exits non-zero on any failure, and
the GitHub Action runs it before building. Add new samples to `tests/samples.json`; `npm test -- --quiet` prints scores only.

## Android app

GitHub Actions builds the APK on every push to `main` (`.github/workflows/android.yml`).
Get it from the repository's **Releases** page, tag `latest`, file **Humanizer.apk**.
You can also run the workflow by hand from the **Actions** tab; each run uploads `Humanizer.apk` as an artifact too.

To install on a phone:

1. Open the Releases page on the phone and download `Humanizer.apk`.
2. Open the file. When Android asks, allow your browser or file manager to install unknown apps.
3. Tap Install. If Play Protect warns about the debug-signed build, choose Install anyway.

To sync the Android project locally (no Android SDK needed for this step):

```
npm run android:sync
```

Building the APK itself needs the Android SDK and JDK 21, which the GitHub runner already has.

## Web version

Needs Node 22 or newer (Capacitor 8).

```
npm install
npm run dev      # dev server
npm run build    # production build in dist/
npm run lint
npm test         # engine tests
```

On Windows you can also double-click `start.bat`.
