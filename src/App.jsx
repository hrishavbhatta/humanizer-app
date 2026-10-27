import { useRef, useState } from 'react'
import { humanize } from './humanizer.js'

const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [changes, setChanges] = useState([])
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const outputPanel = useRef(null)
  const outputBox = useRef(null)

  const run = () => {
    if (!input.trim()) return
    const r = humanize(input)
    setOutput(r.text)
    setChanges(r.changes)
    setCopyFailed(false)
    // On a narrow screen the output sits below the input: bring it into view.
    if (window.matchMedia('(max-width: 767px)').matches) {
      setTimeout(() => outputPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }

  const clear = () => {
    setInput('')
    setOutput('')
    setChanges([])
    setCopyFailed(false)
  }

  const flashCopied = () => {
    setCopied(true)
    setCopyFailed(false)
    setTimeout(() => setCopied(false), 1500)
  }

  const copy = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      flashCopied()
      return
    } catch {
      // Android WebView may lack clipboard permission: fall back to a selection copy.
    }
    try {
      const el = outputBox.current
      el.focus()
      el.select()
      el.setSelectionRange(0, output.length)
      if (document.execCommand('copy')) flashCopied()
      else setCopyFailed(true)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Humanizer</h1>
        <p className="tagline">Make AI-sounding text read like a person wrote it. Works offline.</p>
      </header>

      <div className="panels">
      <section className="panel in">
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

      <div className="actions">
        <button className="btn primary" onClick={run} disabled={!input.trim()}>Humanize</button>
        <button className="btn" onClick={clear} disabled={!input && !output}>Clear</button>
      </div>

      <section className="panel out" ref={outputPanel}>
        <h2>Humanized</h2>
        <textarea ref={outputBox} value={output} readOnly placeholder="Your rewritten text appears here." />
        <div className="panel-foot">
          <span>{countWords(output)} words</span>
          <button className="btn small" onClick={copy} disabled={!output}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        {copyFailed && <p className="muted" role="alert">Could not copy automatically. The text is selected: use your phone's Copy option.</p>}
      </section>
      </div>

      {changes.length > 0 && (
        <details className="changes">
          <summary>What changed</summary>
          <ul>
            {changes.map((c) => (
              <li key={c.label}>
                {c.label}
                {c.n != null && c.n > 1 && ` × ${c.n}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {changes.length === 0 && output && <p className="muted">No changes were needed.</p>}
    </div>
  )
}
