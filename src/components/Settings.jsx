import { useState } from 'react'

export default function Settings({ hasKey, onSave, onRemove, onClose }) {
  const [value, setValue] = useState('')

  return (
    <div className="settings" role="dialog" aria-label="Settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      <label htmlFor="apikey">Anthropic API key (optional)</label>
      <input
        id="apikey"
        type="password"
        autoComplete="off"
        placeholder={hasKey ? 'A key is saved' : 'sk-ant-…'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="hint">
        Saved only in this browser and sent only to api.anthropic.com. Without a key, the offline
        rule-based engine is used.
      </p>
      <div className="row">
        <button
          className="btn primary"
          disabled={!value.trim()}
          onClick={() => {
            onSave(value.trim())
            setValue('')
          }}
        >
          Save
        </button>
        <button className="btn" disabled={!hasKey} onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}
