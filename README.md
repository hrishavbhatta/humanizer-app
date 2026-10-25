# Humanizer

Rewrites AI-sounding text so it reads like a person wrote it, without changing the meaning.

## Run

```
npm install
npm run dev      # start the dev server
npm run build    # production build in dist/
```

On Windows you can also double-click `start.bat`.

## Modes

- **Offline mode (default):** a deterministic, rule-based engine (`src/humanizer.js`). It removes chatbot
  artifacts, filler, and stock AI words, trims transitions, adds contractions, fixes em dashes, and
  splits very long sentences. Text inside double quotes is never changed. Nothing leaves your browser.
- **Claude mode:** open Settings, paste an Anthropic API key, and press Save. Humanize then calls the
  Anthropic Messages API (`claude-sonnet-5-5`) for a fuller rewrite. The system prompt is the full humanizer
  skill (`src/humanizer-skill.md`, based on Wikipedia's "Signs of AI writing"). If the call fails, the app falls back to
  offline mode and shows the error.

The API key is stored only in this browser's localStorage (`humanizer.apiKey`) and is sent only to
`api.anthropic.com`. Use Remove in Settings to delete it.
