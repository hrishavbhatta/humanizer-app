// Optional on-device AI rewrite (Android only). The model runs on the phone; text never leaves it.
// Public API: isAiAvailable, getModelStatus, downloadModel, cancelDownload, deleteModel, rewriteWithAi.
import { humanize, analyze } from '../humanizer.js'
import { segment, buildPrompt, cleanOutput, validate, maxReplyChars } from './core.js'
import * as native from './native.js'

export const MODEL_SIZE_MB = Math.round(native.MODEL.size / 1048576)

export const isAiAvailable = () => {
  try {
    return native.nativeAvailable()
  } catch {
    return false
  }
}

const abortError = () => new DOMException('Cancelled', 'AbortError')
export const isAbort = (e) => e?.name === 'AbortError'

/** { state: 'unavailable' | 'missing' | 'partial' | 'ready', bytes, partialBytes } */
export async function getModelStatus() {
  if (!isAiAvailable()) return { state: 'unavailable', bytes: 0, partialBytes: 0 }
  const s = await native.fileStatus()
  if (s.exists) return { state: 'ready', bytes: s.bytes, partialBytes: 0 }
  return { state: s.partialBytes > 0 ? 'partial' : 'missing', bytes: 0, partialBytes: s.partialBytes }
}

/** Downloads (or resumes) the model. onProgress({ percent, downloaded, total }). Rejects with name 'AbortError' on cancel. */
export async function downloadModel(onProgress = () => {}) {
  try {
    await native.downloadFile((downloaded, total) =>
      onProgress({ percent: Math.min(100, Math.floor((downloaded / total) * 100)), downloaded, total }),
    )
  } catch (e) {
    if (e?.code === 'CANCELLED' || /cancelled/i.test(e?.message || '')) throw abortError()
    throw e
  }
}

export const cancelDownload = () => native.cancelDownload()

export async function deleteModel() {
  native.unloadModel()
  await native.removeFile()
}

class AiFailure extends Error {}

async function rewriteChunk(chunk, signal, ctx) {
  // Two tries. A try that comes back invalid is not an engine failure: we just keep the original text.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw abortError()
    let raw
    try {
      raw = await native.generate(buildPrompt(chunk), { signal, maxChars: maxReplyChars(chunk) * 2 })
    } catch (e) {
      if (isAbort(e)) throw e
      ctx.engineErrors++
      if (ctx.engineErrors >= 2) throw new AiFailure(e?.message || 'AI engine error')
      // One hiccup: reload the model before the retry.
      try {
        await native.loadModel(ctx.path, true)
      } catch (loadError) {
        throw new AiFailure(loadError?.message || 'Could not load the AI model')
      }
      continue
    }
    ctx.engineErrors = 0
    const cleaned = cleanOutput(raw, chunk)
    if (validate(chunk, cleaned).ok) return cleaned
  }
  return null
}

/**
 * Rewrites `text` with the on-device model chunk by chunk, then runs the rule engine over the joined result.
 * Resolves like humanize(): { text, changes, before, after, ai: { total, rewritten, kept } }.
 * Rejects with an AbortError when cancelled; any other rejection means the AI part failed (caller falls back to rules).
 */
export async function rewriteWithAi(text, { onProgress = () => {}, signal } = {}) {
  if (!isAiAvailable()) throw new AiFailure('AI rewrite is not available here')
  const status = await getModelStatus()
  if (status.state !== 'ready') throw new AiFailure('The AI model is not downloaded')
  const { path } = await native.fileStatus()
  try {
    await native.loadModel(path)
  } catch (e) {
    throw new AiFailure(e?.message || 'Could not load the AI model')
  }

  const segments = segment(String(text ?? ''))
  const total = segments.filter((s) => !s.keep).length
  const ctx = { path, engineErrors: 0 }
  let done = 0
  let rewritten = 0
  const parts = []
  onProgress({ done: 0, total })
  for (const seg of segments) {
    if (signal?.aborted) throw abortError()
    if (seg.keep) {
      parts.push(seg.text)
      continue
    }
    onProgress({ done: done + 1, total })
    const out = await rewriteChunk(seg.text, signal, ctx)
    if (out) rewritten++
    parts.push(out ?? seg.text)
    done++
  }
  if (total > 0 && rewritten === 0) throw new AiFailure('No AI rewrite passed the checks')

  const joined = parts.join('')
  const r = humanize(joined)
  const ai = { total, rewritten, kept: total - rewritten }
  return {
    ...r,
    before: analyze(text), // score the text the user pasted, not the intermediate AI text
    changes: [{ label: `AI rewrite (${rewritten} of ${total} passages)` }, ...r.changes],
    ai,
  }
}
