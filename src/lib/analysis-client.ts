import type { AnalysisResult } from './types'

export type AnalysisPhase = 'preparing' | 'analyzing' | 'finalizing'

interface AnalyzeTextAsyncOptions {
  signal?: AbortSignal
  onProgress?: (phase: AnalysisPhase) => void
}

interface WorkerResponse {
  id: string
  type: 'progress' | 'result' | 'error'
  phase?: Exclude<AnalysisPhase, 'preparing'>
  analysis?: AnalysisResult
  message?: string
}

function abortError(): DOMException {
  return new DOMException('Analysis was cancelled.', 'AbortError')
}

async function analyzeWithoutWorker(
  text: string,
  options: AnalyzeTextAsyncOptions,
): Promise<AnalysisResult> {
  if (options.signal?.aborted) throw abortError()
  options.onProgress?.('analyzing')
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  if (options.signal?.aborted) throw abortError()
  const { analyzeText } = await import('./analyzer')
  const analysis = analyzeText(text)
  options.onProgress?.('finalizing')
  return analysis
}

export function analyzeTextAsync(
  text: string,
  options: AnalyzeTextAsyncOptions = {},
): Promise<AnalysisResult> {
  options.onProgress?.('preparing')

  if (typeof Worker === 'undefined') {
    return analyzeWithoutWorker(text, options)
  }

  return new Promise((resolve, reject) => {
    const id = `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const worker = new Worker(
      new URL('../workers/analysis.worker.ts', import.meta.url),
      { type: 'module' },
    )

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.onerror = () => {
      cleanup()
      void analyzeWithoutWorker(text, options).then(resolve, reject)
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.type === 'progress' && message.phase) {
        options.onProgress?.(message.phase)
        return
      }
      cleanup()
      if (message.type === 'result' && message.analysis) {
        resolve(message.analysis)
        return
      }
      reject(new Error(message.message ?? 'Analysis failed.'))
    }

    worker.postMessage({ id, type: 'analyze', text })
  })
}
