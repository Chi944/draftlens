import { analyzeText } from '../lib/analyzer'
import type { AnalysisResult } from '../lib/types'

interface AnalyzeRequest {
  id: string
  type: 'analyze'
  text: string
}

type AnalyzeResponse =
  | { id: string; type: 'progress'; phase: 'analyzing' | 'finalizing' }
  | { id: string; type: 'result'; analysis: AnalysisResult }
  | { id: string; type: 'error'; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalyzeRequest>) => void) | null
  postMessage: (message: AnalyzeResponse) => void
}

scope.onmessage = (event) => {
  if (event.data.type !== 'analyze') return

  const { id, text } = event.data
  try {
    scope.postMessage({ id, type: 'progress', phase: 'analyzing' })
    const analysis = analyzeText(text)
    scope.postMessage({ id, type: 'progress', phase: 'finalizing' })
    scope.postMessage({ id, type: 'result', analysis })
  } catch (cause) {
    scope.postMessage({
      id,
      type: 'error',
      message: cause instanceof Error ? cause.message : 'Analysis failed.',
    })
  }
}

