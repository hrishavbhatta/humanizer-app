# Humanizer

Rewrites AI-sounding text so it reads like a person wrote it, without changing the meaning.
It runs fully offline: there is no server, no account and no API key. Your text never leaves the device.

The same code ships as a web app and as an Android app (built with Capacitor).

## How it works

`src/humanizer.js` is a deterministic, rule-based engine that follows the checklist in
`src/humanizer-skill.md` (based on Wikipedia's "Signs of AI writing"). Text inside double quotes is never changed.
The "What changed" list shows which rules fired.

Covered automatically (fully or in part): chatbot artifacts and offers (§20), inflated importance and
trailing clauses (§1), name-dropping (§2), shallow "-ing" tails (§3), sales language (§4), vague sources (§5),
challenges/outlook boilerplate (§6), stock AI words (§7), avoiding "is/are" (§8), negative parallelisms
and clipped negation (§9), em/en dashes (§14), Title Case headings (§17), emojis and bold (§18),
curly quotes (§19), knowledge-limit text (§21), sycophancy (§22), "not only ... but also" and filler,
stacked hedging (§24), generic endings (§25), hyphenated pairs after a verb (§26), authority tropes (§27),
signposting (§28), contractions and long-sentence splitting.

Not automated, because they need judgment about meaning or voice: §10, §11, §12, §13, §29, §30, §31, §32, §35.
Also skipped on purpose: §34 ("This is not to say that ..."), since dropping it would flip the meaning.

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
```

On Windows you can also double-click `start.bat`.
