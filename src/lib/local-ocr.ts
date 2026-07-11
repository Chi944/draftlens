import type {
  LocalPdfOcrFallback,
  PdfOcrPageInput,
} from './document'

type TesseractModule = typeof import('tesseract.js')
type TesseractWorker = Awaited<
  ReturnType<TesseractModule['createWorker']>
>

export interface LocalOcrProgress {
  progress: number
  status: string
  pageNumber?: number
}

export type LocalOcrProgressHandler = (progress: LocalOcrProgress) => void

function cancelledError(): DOMException {
  return new DOMException('Local OCR was cancelled.', 'AbortError')
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError()
}

function waitForCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  cancel: () => void,
): Promise<T> {
  if (!signal) return promise
  throwIfCancelled(signal)

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      try {
        cancel()
      } finally {
        reject(cancelledError())
      }
    }
    const settle = () => signal.removeEventListener('abort', handleAbort)

    signal.addEventListener('abort', handleAbort, { once: true })
    promise.then(
      (value) => {
        settle()
        resolve(value)
      },
      (cause) => {
        settle()
        reject(cause)
      },
    )
  })
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Creates a reusable, English, browser-only OCR fallback. Tesseract, its
 * worker, core, and trained data are fetched from same-origin build assets only
 * after the first sparse PDF page requests OCR.
 */
export function createLocalPdfOcrFallback(
  onProgress?: LocalOcrProgressHandler,
): LocalPdfOcrFallback {
  let workerPromise: Promise<TesseractWorker> | null = null
  let liveWorker: TesseractWorker | null = null
  let activePageNumber: number | undefined

  const emit = (progress: LocalOcrProgress) => {
    try {
      onProgress?.({
        ...progress,
        progress: clampProgress(progress.progress),
      })
    } catch {
      // Display callbacks must not interrupt OCR.
    }
  }

  const startWorker = async (
    signal?: AbortSignal,
  ): Promise<TesseractWorker> => {
    const [
      tesseract,
      { default: workerPath },
      { default: corePath },
      { default: languageDataPath },
    ] = await Promise.all([
      import('tesseract.js'),
      import('tesseract.js/dist/worker.min.js?url'),
      import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
      import('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url'),
    ])

    throwIfCancelled(signal)
    const response = await fetch(languageDataPath, {
      cache: 'force-cache',
      signal,
    })
    if (!response.ok) {
      throw new Error(
        `Local English OCR data could not be loaded (${response.status}).`,
      )
    }
    const languageData = new Uint8Array(await response.arrayBuffer())

    return tesseract.createWorker(
      [{ code: 'eng', data: languageData }],
      tesseract.OEM.LSTM_ONLY,
      {
        workerPath,
        corePath,
        gzip: true,
        cacheMethod: 'write',
        logger: (message) => {
          emit({
            progress: message.progress,
            status: message.status,
            ...(activePageNumber === undefined
              ? {}
              : { pageNumber: activePageNumber }),
          })
        },
      },
    )
  }

  const getWorker = (signal?: AbortSignal): Promise<TesseractWorker> => {
    if (workerPromise) return workerPromise

    const pendingWorker = startWorker(signal)
    workerPromise = pendingWorker
    void pendingWorker.then(
      (worker) => {
        if (workerPromise === pendingWorker) liveWorker = worker
        else void worker.terminate()
      },
      () => {
        if (workerPromise === pendingWorker) workerPromise = null
      },
    )
    return pendingWorker
  }

  const dispose = async (): Promise<void> => {
    const worker = liveWorker
    workerPromise = null
    liveWorker = null

    if (worker) await worker.terminate()
  }

  const recognizePage = async ({
    pageNumber,
    signal,
    renderPageImage,
  }: PdfOcrPageInput): Promise<string> => {
    activePageNumber = pageNumber
    try {
      throwIfCancelled(signal)
      emit({ progress: 0, status: 'rendering PDF page', pageNumber })
      const image = await renderPageImage(2)
      throwIfCancelled(signal)
      emit({ progress: 0, status: 'initializing local OCR', pageNumber })

      const worker = await waitForCancellation(
        getWorker(signal),
        signal,
        () => void dispose(),
      )
      const result = await waitForCancellation(
        worker.recognize(image, { rotateAuto: true }),
        signal,
        () => void dispose(),
      )
      emit({ progress: 1, status: 'recognizing text', pageNumber })
      return result.data.text
    } catch (cause) {
      await dispose()
      throw cause
    } finally {
      activePageNumber = undefined
    }
  }

  return {
    recognizePage,
    dispose,
  }
}
