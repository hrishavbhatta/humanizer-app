import skill from './humanizer-skill.md?raw'

export const MODEL = 'claude-sonnet-5-5'

// The full humanizer skill (Wikipedia "Signs of AI writing"), minus its YAML header,
// run in the skill's embedded mode so Claude returns only the final text.
const SKILL = skill.replace(/^---[\s\S]*?\n---\s*/, '')

export const SYSTEM_PROMPT = `${SKILL}

---

## How this app uses the skill

You are running inside a humanizer web app. Use embedded mode: follow the full rewrite process above, but return only the final rewrite, with no draft, no list of remaining patterns, no notes and nothing before or after the text.

Never change text inside quotation marks except straightening curly quotes (§19). Keep paragraph breaks.`

export function buildUserMessage(text) {
  return `<text>\n${text}\n</text>`
}
