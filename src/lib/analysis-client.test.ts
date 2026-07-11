import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeTextAsync, type AnalysisPhase } from './analysis-client'

const report = Array(60)
  .fill('The observer recorded a distinct event beside the loading bay.')
  .join(' ')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('background analysis client', () => {
  it('falls back safely when workers are unavailable and reports progress', async () => {
    vi.stubGlobal('Worker', undefined)
    const phases: AnalysisPhase[] = []

    const result = await analyzeTextAsync(report, {
      onProgress: (phase) => phases.push(phase),
    })

    expect(result.coverage.qualifyingWordCount).toBeGreaterThanOrEqual(300)
    expect(phases).toEqual(['preparing', 'analyzing', 'finalizing'])
  })

  it('honors cancellation before fallback analysis begins', async () => {
    vi.stubGlobal('Worker', undefined)
    const controller = new AbortController()
    controller.abort()

    await expect(
      analyzeTextAsync(report, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('falls back when a worker asset cannot start, including offline', async () => {
    class FailedWorker {
      onerror: (() => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null

      postMessage() {
        queueMicrotask(() => this.onerror?.())
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', FailedWorker)

    const result = await analyzeTextAsync(report)
    expect(result.coverage.qualifyingWordCount).toBeGreaterThanOrEqual(300)
  })
})
