import { useState } from 'react'
import { humanize } from './humanizer.js'
import { humanizeWithClaude, loadKey, saveKey, removeKey } from './claude.js'
import Settings from './components/Settings.jsx'

const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [changes, setChanges] = useState([])
  const [apiKey, setApiKey] = useState(loadKey)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const run = async () => {
    if (!input.trim() || loading) return
    setNotice('')
    if (apiKey) {
      setLoading(true)
      try {
        const text = await humanizeWithClaude(input, apiKey)
        setOutput(text)
        setChanges([{ label: 'Rewritten by Claude', n: null }])
      } catch (err) {
        const r = humanize(input)
        setOutput(r.text)
        setChanges(r.changes)
        setNotice(`Claude request failed (${err.message}). Used offline mode instead.`)
      } finally {
        setLoading(false)
      }
    } else {
      const r = humanize(input)
      setOutput(r.text)
      setChanges(r.changes)
    }
  }

  const clear = () => {
    setInput('')
    setOutput('')
    setChanges([])
    setNotice('')
  }

  const copy = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setNotice('Could not copy automatically. Select the text and copy it manually.')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Humanizer</h1>
          <p className="tagline">Make AI-sounding text read like a person wrote it.</p>
        </div>
        <button className="link" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          ⚙ Settings
        </button>
      </header>

      {showSettings && (
        <Settings
          hasKey={!!apiKey}
          onSave={(k) => {
            saveKey(k)
            setApiKey(k)
            setShowSettings(false)
          }}
          onRemove={() => {
            removeKey()
            setApiKey('')
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="controls">
        <div className="actions">
          <span className={apiKey ? 'badge claude' : 'badge'}>{apiKey ? 'Claude mode' : 'Offline mode'}</span>
          <button className="btn primary" onClick={run} disabled={loading || !input.trim()}>
            {loading ? 'Humanizing…' : 'Humanize'}
          </button>
          <button className="btn" onClick={clear} disabled={loading}>Clear</button>
        </div>
      </div>

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button className="link" onClick={() => setNotice('')} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="panels">
        <section className="panel">
          <h2>Your text</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                run()
              }
            }}
            placeholder="Paste AI-generated text here… (Ctrl+Enter to humanize)"
          />
          <div className="panel-foot">
            <span>{countWords(input)} words</span>
          </div>
        </section>

        <section className="panel">
          <h2>Humanized</h2>
          <textarea value={output} readOnly placeholder="Your rewritten text appears here." />
          <div className="panel-foot">
            <span>{countWords(output)} words</span>
            <button className="btn small" onClick={copy} disabled={!output}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </section>
      </div>

      {changes.length > 0 && (
        <details className="changes">
          <summary>What changed</summary>
          <ul>
            {changes.map((c) => (
              <li key={c.label}>
                {c.label}
                {c.n != null && ` × ${c.n}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {changes.length === 0 && output && <p className="muted">No changes were needed.</p>}
    </div>
  )
}
