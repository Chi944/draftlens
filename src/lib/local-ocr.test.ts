import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLocalPdfOcrFallback } from './local-ocr'
import type { PdfOcrPageInput } from './document'

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}))

vi.mock('tesseract.js', () => ({
  createWorker: mocks.createWorker,
  OEM: { LSTM_ONLY: 1 },
}))

vi.mock('tesseract.js/dist/worker.min.js?url', () => ({
  default: '/assets/tesseract-worker.js',
}))

vi.mock('tesseract.js-core/tesseract-core-lstm.wasm.js?url', () => ({
  default: '/assets/tesseract-core-lstm.js',
}))

vi.mock(
  '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url',
  () => ({ default: '/assets/eng.traineddata.gz' }),
)

function makeInput(
  pageNumber = 1,
  signal?: AbortSignal,
): PdfOcrPageInput {
  return {
    file: new File(['pdf'], 'scan.pdf', { type: 'application/pdf' }),
    pageNumber,
    pageCount: 2,
    signal,
    renderPageImage: vi
      .fn()
      .mockResolvedValue(new Blob(['image'], { type: 'image/png' })),
  }
}

describe('local PDF OCR adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recognize.mockResolvedValue({ data: { text: 'Recovered locally.' } })
    mocks.terminate.mockResolvedValue(undefined)
    mocks.createWorker.mockResolvedValue({
      recognize: mocks.recognize,
      terminate: mocks.terminate,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(new Uint8Array([31, 139, 8, 0]).buffer),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads Tesseract lazily and uses same-origin worker, core, and language assets', async () => {
    const fallback = createLocalPdfOcrFallback()
    const input = makeInput()

    expect(mocks.createWorker).not.toHaveBeenCalled()
    await expect(fallback.recognizePage(input)).resolves.toBe(
      'Recovered locally.',
    )

    expect(input.renderPageImage).toHaveBeenCalledWith(2)
    expect(fetch).toHaveBeenCalledWith(
      '/assets/eng.traineddata.gz',
      expect.objectContaining({ cache: 'force-cache' }),
    )
    const [languages, oem, workerOptions] = mocks.createWorker.mock.calls[0]
    expect(languages).toEqual([
      { code: 'eng', data: new Uint8Array([31, 139, 8, 0]) },
    ])
    expect(oem).toBe(1)
    expect(workerOptions).toMatchObject({
      workerPath: '/assets/tesseract-worker.js',
      corePath: '/assets/tesseract-core-lstm.js',
      gzip: true,
      cacheMethod: 'write',
    })
    expect(JSON.stringify(workerOptions)).not.toContain('http')
    expect(mocks.recognize).toHaveBeenCalledWith(
      expect.any(Blob),
      { rotateAuto: true },
    )
  })

  it('reuses one worker across pages and terminates it on disposal', async () => {
    const fallback = createLocalPdfOcrFallback()

    await fallback.recognizePage(makeInput(1))
    await fallback.recognizePage(makeInput(2))
    await fallback.dispose?.()

    expect(mocks.createWorker).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.recognize).toHaveBeenCalledTimes(2)
    expect(mocks.terminate).toHaveBeenCalledOnce()
  })

  it('forwards bounded worker progress with the active page number', async () => {
    const onProgress = vi.fn()
    mocks.createWorker.mockImplementation(
      async (_languages, _oem, options) => {
        options.logger({
          progress: 1.4,
          status: 'recognizing text',
        })
        return {
          recognize: mocks.recognize,
          terminate: mocks.terminate,
        }
      },
    )
    const fallback = createLocalPdfOcrFallback(onProgress)

    await fallback.recognizePage(makeInput(2))

    expect(onProgress).toHaveBeenCalledWith({
      progress: 1,
      status: 'recognizing text',
      pageNumber: 2,
    })
  })

  it('terminates the worker when an active recognition is cancelled', async () => {
    mocks.recognize.mockReturnValue(
      new Promise(() => undefined),
    )
    const controller = new AbortController()
    const fallback = createLocalPdfOcrFallback()
    const recognition = fallback.recognizePage(
      makeInput(1, controller.signal),
    )
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledOnce())

    controller.abort()

    await expect(recognition).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.terminate).toHaveBeenCalledOnce())
  })
})
