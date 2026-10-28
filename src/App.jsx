import { useEffect, useRef, useState } from 'react'
import { humanize } from './humanizer.js'
import {
  MODEL_SIZE_MB,
  cancelDownload,
  deleteModel,
  downloadModel,
  getModelStatus,
  isAbort,
  isAiAvailable,
  rewriteWithAi,
} from './ai/index.js'

const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0)

// " · ~2 min left" / " · ~40 s left"; empty until the first passage has given a speed estimate.
const timeLeft = (s) => (s == null || s <= 0 ? '' : s >= 90 ? ` · ~${Math.round(s / 60)} min left` : ` · ~${Math.max(5, Math.round(s / 5) * 5)} s left`)
const AI_KEY = 'humanizer.aiRewrite'
const AI_AVAILABLE = isAiAvailable()
const readAiPref = () => {
  try {
    return AI_AVAILABLE && localStorage.getItem(AI_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [changes, setChanges] = useState([])
  const [meter, setMeter] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const outputPanel = useRef(null)
  const outputBox = useRef(null)

  const [aiOn, setAiOn] = useState(readAiPref)
  const [model, setModel] = useState('unknown') // unknown | missing | partial | ready
  const [dl, setDl] = useState(null) // { percent } while downloading
  const [dlError, setDlError] = useState('')
  const [progress, setProgress] = useState(null) // { done, total } while rewriting
  const [notice, setNotice] = useState('')
  const aiAbort = useRef(null)

  const refreshModel = async () => {
    try {
      setModel((await getModelStatus()).state)
    } catch {
      setModel('missing')
    }
  }
  useEffect(() => {
    if (!AI_AVAILABLE) return
    getModelStatus().then((s) => setModel(s.state), () => setModel('missing'))
  }, [])

  const toggleAi = (on) => {
    setAiOn(on)
    setNotice('')
    try {
      localStorage.setItem(AI_KEY, on ? '1' : '0')
    } catch {
      // Storage can be unavailable: the switch just will not be remembered.
    }
  }

  const startDownload = async () => {
    setDlError('')
    setDl({ percent: 0 })
    try {
      await downloadModel((p) => setDl({ percent: p.percent }))
    } catch (e) {
      if (!isAbort(e)) setDlError(String(e?.message || 'The download failed. Check your connection and try again.'))
    } finally {
      setDl(null)
      await refreshModel()
    }
  }

  const removeModel = async () => {
    try {
      await deleteModel()
    } catch {
      // Ignore: the status refresh below shows whether the file is still there.
    }
    await refreshModel()
  }

  const show = (r) => {
    setOutput(r.text)
    setChanges(r.changes)
    setMeter({ before: r.before.score, after: r.after.score })
    setCopyFailed(false)
    // On a narrow screen the output sits below the input: bring it into view.
    if (window.matchMedia('(max-width: 767px)').matches) {
      setTimeout(() => outputPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }

  const run = async () => {
    if (!input.trim() || progress) return
    setNotice('')
    if (!(aiOn && model === 'ready')) {
      show(humanize(input))
      return
    }
    const ctl = new AbortController()
    aiAbort.current = ctl
    setProgress({ done: 0, total: 0 })
    setChanges([])
    setMeter(null)
    const onProgress = (p) => {
      setProgress(p)
      if (p.done) setOutput(p.partial) // show rewritten passages as soon as they are ready
    }
    try {
      show(await rewriteWithAi(input, { signal: ctl.signal, onProgress }))
    } catch (e) {
      if (e?.partial) {
        show(e.partial)
        setNotice(`Stopped early: ${e.partial.ai.rewritten} of ${e.partial.ai.total} passages were rewritten by AI, the rest by rules.`)
      } else if (isAbort(e)) {
        setOutput('')
        setNotice('Cancelled. Nothing was changed.')
      } else {
        setNotice('AI rewrite failed, used rules only.')
        show(humanize(input))
      }
    } finally {
      aiAbort.current = null
      setProgress(null)
    }
  }

  const clear = () => {
    setInput('')
    setOutput('')
    setChanges([])
    setMeter(null)
    setCopyFailed(false)
    setNotice('')
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

  const busy = !!progress

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
          readOnly={busy}
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

      <div className="act">
      <div className="actions">
        <button className="btn primary" onClick={run} disabled={!input.trim() || busy}>
          {busy ? (progress.total ? `Rewriting ${progress.done}/${progress.total}${timeLeft(progress.secondsLeft)}…` : 'Preparing AI…') : 'Humanize'}
        </button>
        {busy ? (
          <button className="btn" onClick={() => aiAbort.current?.abort()}>{progress.done ? 'Stop' : 'Cancel'}</button>
        ) : (
          <button className="btn" onClick={clear} disabled={!input && !output}>Clear</button>
        )}
      </div>

      {AI_AVAILABLE && (
        <div className="ai">
          <label className="switch">
            <input type="checkbox" checked={aiOn} onChange={(e) => toggleAi(e.target.checked)} disabled={busy || !!dl} />
            <span>AI rewrite (beta)</span>
          </label>
          {aiOn && model === 'ready' && (
            <>
              <p className="muted">
                On: Humanize rewrites sentences with a small AI model on this phone, then applies the rules. It is slower and needs about 1.5 GB of free memory.{' '}
                <button className="link" onClick={removeModel} disabled={busy}>Delete AI model</button>
              </p>
              <p className="muted small-print">Model: Qwen2.5-0.5B-Instruct (Apache-2.0). Your text never leaves the phone.</p>
            </>
          )}
          {aiOn && (model === 'missing' || model === 'partial') && (
            <div className="card">
              <p>
                Download AI model (about {MODEL_SIZE_MB} MB, one time, then works offline). Use Wi-Fi.
                {model === 'partial' && !dl && ' The partly finished download will resume.'}
              </p>
              {dl ? (
                <>
                  <div className="meter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dl.percent}>
                    <span className="now" style={{ width: `${dl.percent}%` }} />
                  </div>
                  <div className="card-row">
                    <span className="muted">{dl.percent}%</span>
                    <button className="btn small" onClick={() => cancelDownload()}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="card-row">
                  <button className="btn small primary" onClick={startDownload}>
                    {dlError ? 'Retry' : model === 'partial' ? 'Resume' : 'Download'}
                  </button>
                </div>
              )}
              {dlError && <p className="error" role="alert">{dlError}</p>}
            </div>
          )}
        </div>
      )}
      {notice && <p className="muted" role="status">{notice}</p>}
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
        {meter && output && (
          <div className="meter" role="img" aria-label={`AI-pattern score ${meter.before} before, ${meter.after} after, out of 100. Lower reads more natural.`}>
            <p className="meter-line">
              AI-pattern score: <strong>{meter.before} → {meter.after}</strong>
            </p>
            <div className="meter-bar">
              <span className="was" style={{ width: `${meter.before}%` }} />
              <span className="now" style={{ width: `${meter.after}%` }} />
            </div>
          </div>
        )}
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
