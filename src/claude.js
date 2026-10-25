import { MODEL, SYSTEM_PROMPT, buildUserMessage } from './prompt.js'

const KEY = 'humanizer.apiKey'

export function loadKey() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function saveKey(key) {
  try {
    localStorage.setItem(KEY, key)
    return true
  } catch {
    return false
  }
}

export function removeKey() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export async function humanizeWithClaude(text, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(text) }],
    }),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'Request failed'
    throw new Error(`${res.status} ${msg.slice(0, 160)}`)
  }
  const out = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!out) throw new Error('Empty response from Claude')
  return out
}
