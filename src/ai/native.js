// Thin wrapper around the two native Capacitor plugins:
//   ModelFiles (android/app/src/main/java/.../ModelFilesPlugin.java): download, resume, cancel, check and delete the model file.
//   CapgoLLM   (@capgo/capacitor-llm): loads the model and generates text. Used through its MediaPipe .task path.
// The plugin packages are not imported in JS (their web code needs extra dependencies); registerPlugin finds the native side.
import { Capacitor, registerPlugin } from '@capacitor/core'

export const MODEL = {
  name: 'Qwen2.5-0.5B-Instruct (8-bit, MediaPipe .task)',
  // Pinned to a commit so the file cannot change under us. Public, Apache-2.0, no login.
  url: 'https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/063da0a7c3baec2dbfb79b95947a434d2634b260/Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task',
  filename: 'Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task',
  size: 546660344,
}

const Files = registerPlugin('ModelFiles')
const LLM = registerPlugin('CapgoLLM')

export const nativeAvailable = () =>
  Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ModelFiles') && Capacitor.isPluginAvailable('CapgoLLM')

export const fileStatus = () => Files.status({ filename: MODEL.filename, size: MODEL.size })

export async function downloadFile(onBytes) {
  const handle = await Files.addListener('modelProgress', (e) => onBytes(e.downloaded, e.total || MODEL.size))
  try {
    return await Files.download({ url: MODEL.url, filename: MODEL.filename, size: MODEL.size })
  } finally {
    handle.remove()
  }
}

export const cancelDownload = () => Files.cancel()
export const removeFile = () => Files.delete({ filename: MODEL.filename })

// ---- inference ----
let loadedPath = null
let busyUntil = Promise.resolve() // resolves when the native side has finished the last (possibly abandoned) generation

export async function loadModel(path, force = false) {
  if (loadedPath === path && !force) return
  loadedPath = null
  await LLM.setModel({
    path,
    modelType: 'task', // not .litertlm: the plugin then uses its MediaPipe backend
    maxTokens: 1024, // prompt + reply must fit in the model's 1280-token cache
    topk: 40,
    temperature: 0.3,
    randomSeed: 7,
  })
  loadedPath = path
}

export const unloadModel = () => {
  loadedPath = null
}

const withTimeout = (p, ms, msg) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })

/**
 * Send one prompt, collect the streamed reply. The native side has no cancel, so on abort, timeout or an overlong
 * reply we stop waiting but remember when the native generation really ends (busyUntil) before starting the next one.
 */
export async function generate(prompt, { signal, maxChars = 2000, timeoutMs = 120000 } = {}) {
  await withTimeout(busyUntil, 60000, 'AI engine is still busy').catch(() => {})
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  const { id } = await LLM.createChat()
  let text = ''
  let finish
  let fail
  const finished = new Promise((res, rej) => ((finish = res), (fail = rej)))
  let nativeDone
  busyUntil = new Promise((res) => (nativeDone = res))

  const handles = await Promise.all([
    LLM.addListener('textFromAi', (e) => {
      if (e.chatId !== id) return
      text += e.text || ''
      if (text.length > maxChars) finish('overlong')
    }),
    LLM.addListener('aiFinished', (e) => {
      if (e.chatId === id) {
        nativeDone()
        finish('done')
      }
    }),
    LLM.addListener('generationError', (e) => {
      if (!e.chatId || e.chatId === id) {
        nativeDone()
        fail(new Error(e.error || 'Generation failed'))
      }
    }),
  ])
  const onAbort = () => fail(new DOMException('Cancelled', 'AbortError'))
  signal?.addEventListener('abort', onAbort)
  try {
    try {
      await LLM.sendMessage({ chatId: id, message: prompt })
    } catch (e) {
      nativeDone() // nothing started, so nothing to wait for
      throw e
    }
    await withTimeout(finished, timeoutMs, 'AI took too long')
    return text
  } catch (e) {
    // Give up on this generation; the next call waits for the native side (or for the 60 s cap above).
    if (e?.name !== 'AbortError' && /took too long/.test(e?.message || '')) loadedPath = null
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
    handles.forEach((h) => h.remove())
  }
}
