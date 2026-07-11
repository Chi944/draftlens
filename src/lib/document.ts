/// <reference types="vite/client" />

export const ACCEPTED_FILE_TYPES = ['.txt', '.md', '.docx', '.pdf'] as const
export const FILE_ACCEPT = ACCEPTED_FILE_TYPES.join(',')
export const ACCEPTED_FILE_ACCEPT = FILE_ACCEPT
export const accept = FILE_ACCEPT

export type DocumentKind = 'txt' | 'md' | 'docx' | 'pdf'

export type DocumentExtractionMethod =
  | 'plain-text'
  | 'docx-text'
  | 'pdf-text'
  | 'pdf-ocr'
  | 'pdf-mixed'

export type PdfTextDetection =
  | 'readable-text'
  | 'sparse-text'
  | 'image-only'

export type DocumentExtractionPhase =
  | 'reading'
  | 'extracting'
  | 'ocr'
  | 'finalizing'
  | 'complete'

export interface SourceFileMetadata {
  name: string
  kind: DocumentKind
  sizeBytes: number
  mimeType: string
  lastModified: number
}

export interface ExtractedPageSpan {
  pageNumber: number
  start: number
  end: number
  textSource: 'embedded-text' | 'ocr' | 'none'
  detection: PdfTextDetection
}

export interface DocumentImportWarning {
  code: 'sparse-pdf-pages' | 'ocr-failed' | 'ocr-empty'
  message: string
  pageNumbers: number[]
}

export interface DocumentImportReceipt {
  importedAt: string
  method: DocumentExtractionMethod
  characterCount: number
  pageCount?: number
  sparsePdfPages: number[]
  ocrPages: number[]
  warnings: DocumentImportWarning[]
}

export interface DocumentExtractionProgress {
  phase: DocumentExtractionPhase
  completed: number
  total: number
  pageNumber?: number
}

export interface PdfOcrPageInput {
  file: File
  pageNumber: number
  pageCount: number
  signal?: AbortSignal
  renderPageImage: (scale?: number) => Promise<Blob>
}

export interface LocalPdfOcrFallback {
  recognizePage: (input: PdfOcrPageInput) => Promise<string>
  minimumEmbeddedCharacters?: number
  minimumEmbeddedWords?: number
  /** Releases any worker owned by this fallback after the current import. */
  dispose?: () => Promise<void> | void
}

export interface DocumentExtractionOptions {
  signal?: AbortSignal
  onProgress?: (progress: DocumentExtractionProgress) => void
  /**
   * Explicit, caller-supplied in-browser OCR. DraftLens does not load or call an
   * OCR service unless this option is provided.
   */
  localPdfOcr?: LocalPdfOcrFallback
  importedAt?: Date
}

export interface ExtractedDocument {
  text: string
  name: string
  kind: DocumentKind
  pageCount?: number
  source: SourceFileMetadata
  pageSpans: ExtractedPageSpan[]
  receipt: DocumentImportReceipt
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_EXTRACTED_CHARACTERS = 2_000_000
const MAX_PDF_PAGES = 500
const MAX_OCR_CANVAS_PIXELS = 16_000_000
const MAX_OCR_CANVAS_SIDE = 8_192
const SUPPORTED_KINDS = new Set<DocumentKind>(['txt', 'md', 'docx', 'pdf'])
const PDF_BOUNDARY_RATIO = 0.12
const PDF_PAGE_NUMBER_PATTERN =
  /^\s*(?:page\s+)?(?:\d{1,4}|[ivxlcdm]+)(?:\s*(?:of|\/|-|\u2013)\s*(?:\d{1,4}|[ivxlcdm]+))?\s*$/iu
const DEFAULT_MINIMUM_EMBEDDED_CHARACTERS = 24
const DEFAULT_MINIMUM_EMBEDDED_WORDS = 4

type PdfBoundaryBand = 'top' | 'bottom'

interface PdfTextItem {
  str: string
  hasEOL?: boolean
  transform?: number[]
  height?: number
}

interface PdfLine {
  text: string
  y?: number
}

interface PdfPageText {
  height?: number
  lines: PdfLine[]
}

interface RenderablePdfPage {
  getViewport: (options: { scale: number }) => {
    width: number
    height: number
  }
  render: (options: {
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
  }) => {
    promise: Promise<unknown>
    cancel?: () => void
  }
  cleanup?: () => void
}

interface PdfExtractionResult {
  text: string
  pageCount: number
  pageSpans: ExtractedPageSpan[]
  sparsePdfPages: number[]
  ocrPages: number[]
  warnings: DocumentImportWarning[]
  method: Extract<DocumentExtractionMethod, 'pdf-text' | 'pdf-ocr' | 'pdf-mixed'>
}

interface PositionedPdfItem {
  text: string
  x: number
  y: number
  height: number
}

class ScannedPdfError extends Error {}
class DocumentLimitError extends Error {}

function abortError(): DOMException {
  return new DOMException('Document extraction was cancelled.', 'AbortError')
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function waitForAbortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      try {
        onAbort?.()
      } finally {
        reject(abortError())
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

function reportProgress(
  options: DocumentExtractionOptions,
  progress: DocumentExtractionProgress,
): void {
  throwIfAborted(options.signal)
  options.onProgress?.(progress)
  throwIfAborted(options.signal)
}

function appendPdfText(current: string, next: string): string {
  const text = next.trim()
  if (!text) return current
  if (!current) return text

  const needsSpace =
    !/[\s([{]$/u.test(current) && !/^[,.;:!?)}\]]/u.test(text)
  return `${current}${needsSpace ? ' ' : ''}${text}`
}

function fallbackPdfLines(items: PdfTextItem[]): PdfLine[] {
  let pageText = ''

  items.forEach((item) => {
    if (!item.str) return
    pageText = appendPdfText(pageText, item.str)
    if (item.hasEOL) pageText += '\n'
  })

  return pageText
    .split(/\r?\n/u)
    .map((text) => ({ text: text.trim() }))
    .filter((line) => line.text.length > 0)
}

function reconstructPdfLines(items: PdfTextItem[]): PdfLine[] {
  const readableItems = items.filter((item) => item.str.trim().length > 0)
  const positionedItems: PositionedPdfItem[] = []

  readableItems.forEach((item) => {
    const x = item.transform?.[4]
    const y = item.transform?.[5]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return

    positionedItems.push({
      text: item.str,
      x: x as number,
      y: y as number,
      height: Number.isFinite(item.height) ? Math.abs(item.height as number) : 0,
    })
  })

  if (positionedItems.length !== readableItems.length) {
    return fallbackPdfLines(readableItems)
  }

  positionedItems.sort((left, right) => right.y - left.y || left.x - right.x)
  const groups: Array<{
    y: number
    height: number
    items: PositionedPdfItem[]
  }> = []

  positionedItems.forEach((item) => {
    const previous = groups.at(-1)
    const tolerance = previous
      ? Math.max(2, Math.min(6, Math.max(previous.height, item.height) * 0.5))
      : 2

    if (previous && Math.abs(previous.y - item.y) <= tolerance) {
      previous.items.push(item)
      previous.height = Math.max(previous.height, item.height)
      return
    }

    groups.push({ y: item.y, height: item.height, items: [item] })
  })

  return groups.map((group) => ({
    text: group.items
      .sort((left, right) => left.x - right.x)
      .reduce((text, item) => appendPdfText(text, item.text), ''),
    y: group.y,
  }))
}

function boundaryBand(line: PdfLine, page: PdfPageText): PdfBoundaryBand | null {
  if (line.y === undefined || !page.height || page.height <= 0) return null
  if (line.y >= page.height * (1 - PDF_BOUNDARY_RATIO)) return 'top'
  if (line.y <= page.height * PDF_BOUNDARY_RATIO) return 'bottom'
  return null
}

function normalizeBoundaryText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

function boundaryArtifactKey(
  line: PdfLine,
  page: PdfPageText,
): string | null {
  const band = boundaryBand(line, page)
  if (!band) return null

  const normalized = normalizeBoundaryText(line.text)
  const wordCount = normalized.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  if (
    !normalized ||
    wordCount === 0 ||
    wordCount > 20 ||
    /[.!?]["'\u201d\u2019)}\]]*$/u.test(normalized)
  ) {
    return null
  }

  return `${band}:${normalized}`
}

function repeatedBoundaryArtifactKeys(pages: PdfPageText[]): Set<string> {
  const pagesByKey = new Map<string, Set<number>>()

  pages.forEach((page, pageIndex) => {
    page.lines.forEach((line) => {
      const key = boundaryArtifactKey(line, page)
      if (!key || PDF_PAGE_NUMBER_PATTERN.test(line.text)) return
      const pageIndexes = pagesByKey.get(key) ?? new Set<number>()
      pageIndexes.add(pageIndex)
      pagesByKey.set(key, pageIndexes)
    })
  })

  return new Set(
    [...pagesByKey.entries()]
      .filter(([, pageIndexes]) => pageIndexes.size >= 2)
      .map(([key]) => key),
  )
}

function cleanPdfPages(pages: PdfPageText[]): string[] {
  const repeatedArtifacts = repeatedBoundaryArtifactKeys(pages)

  return pages.map((page) =>
    page.lines
      .filter((line) => {
        const band = boundaryBand(line, page)
        if (!band) return true
        if (PDF_PAGE_NUMBER_PATTERN.test(line.text)) return false

        const key = boundaryArtifactKey(line, page)
        return !key || !repeatedArtifacts.has(key)
      })
      .map((line) => line.text)
      .join('\n')
      .trim(),
  )
}

function detectPdfText(
  text: string,
  localOcr?: LocalPdfOcrFallback,
): PdfTextDetection {
  const compact = text.replace(/\s+/gu, ' ').trim()
  if (!compact) return 'image-only'

  const characters = compact.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  const words = compact.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  const minimumCharacters = Math.max(
    1,
    localOcr?.minimumEmbeddedCharacters ??
      DEFAULT_MINIMUM_EMBEDDED_CHARACTERS,
  )
  const minimumWords = Math.max(
    1,
    localOcr?.minimumEmbeddedWords ?? DEFAULT_MINIMUM_EMBEDDED_WORDS,
  )

  return characters < minimumCharacters || words < minimumWords
    ? 'sparse-text'
    : 'readable-text'
}

async function renderPdfPageImage(
  page: RenderablePdfPage,
  signal?: AbortSignal,
  requestedScale = 2,
): Promise<Blob> {
  throwIfAborted(signal)
  if (typeof document === 'undefined') {
    throw new Error('PDF page rendering is unavailable in this environment.')
  }

  const scale = Math.max(1, Math.min(3, requestedScale))
  const viewport = page.getViewport({ scale })
  const width = Math.max(1, Math.ceil(viewport.width))
  const height = Math.max(1, Math.ceil(viewport.height))
  if (
    width > MAX_OCR_CANVAS_SIDE ||
    height > MAX_OCR_CANVAS_SIDE ||
    width * height > MAX_OCR_CANVAS_PIXELS
  ) {
    throw new DocumentLimitError(
      'This PDF page is too large to render safely for local OCR.',
    )
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) {
    throw new Error('This browser could not prepare the PDF page for OCR.')
  }

  try {
    const renderTask = page.render({ canvasContext, viewport })
    await waitForAbortable(
      renderTask.promise,
      signal,
      () => renderTask.cancel?.(),
    )

    return await waitForAbortable(
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('This browser could not create the OCR image.'))
        }, 'image/png')
      }),
      signal,
    )
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function joinPdfPageText(
  pages: Array<{
    text: string
    detection: PdfTextDetection
    textSource: ExtractedPageSpan['textSource']
  }>,
): { text: string; pageSpans: ExtractedPageSpan[] } {
  let text = ''
  const pageSpans: ExtractedPageSpan[] = []

  pages.forEach((page, pageIndex) => {
    const pageText = page.text.trim()
    if (pageText && text) text += '\n\n'
    const start = text.length
    if (pageText) text += pageText

    pageSpans.push({
      pageNumber: pageIndex + 1,
      start,
      end: text.length,
      textSource: pageText ? page.textSource : 'none',
      detection: page.detection,
    })
  })

  return { text, pageSpans }
}

function getDocumentKind(fileName: string): DocumentKind | null {
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1]

  return extension && SUPPORTED_KINDS.has(extension as DocumentKind)
    ? (extension as DocumentKind)
    : null
}

function unreadableFileError(fileName: string): Error {
  return new Error(
    `We couldn't read "${fileName}". It may be password-protected or damaged.`,
  )
}

async function extractDocxText(
  file: File,
  options: DocumentExtractionOptions,
): Promise<string> {
  try {
    throwIfAborted(options.signal)
    const mammoth = await import('mammoth')
    const arrayBuffer = await waitForAbortable(
      file.arrayBuffer(),
      options.signal,
    )
    const result = await waitForAbortable(
      mammoth.extractRawText({ arrayBuffer }),
      options.signal,
    )
    return result.value
  } catch (cause) {
    if (isAbortError(cause)) throw cause
    throw unreadableFileError(file.name)
  }
}

async function extractPdfText(
  file: File,
  options: DocumentExtractionOptions,
): Promise<PdfExtractionResult> {
  try {
    throwIfAborted(options.signal)
    const [{ GlobalWorkerOptions, getDocument }, { default: pdfWorkerUrl }] =
      await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
    throwIfAborted(options.signal)
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    reportProgress(options, { phase: 'reading', completed: 0, total: 1 })
    const data = new Uint8Array(
      await waitForAbortable(file.arrayBuffer(), options.signal),
    )
    reportProgress(options, { phase: 'reading', completed: 1, total: 1 })

    const loadingTask = getDocument({ data })
    const pdf = await waitForAbortable(
      loadingTask.promise,
      options.signal,
      () => void loadingTask.destroy(),
    )
    const pageProxies: RenderablePdfPage[] = []
    try {
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new DocumentLimitError(
          `"${file.name}" has more than ${MAX_PDF_PAGES} pages and cannot be reviewed safely in the browser.`,
        )
      }
      const pages: PdfPageText[] = []
      let extractedCharacterCount = 0

    reportProgress(options, {
      phase: 'extracting',
      completed: 0,
      total: pdf.numPages,
    })
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfAborted(options.signal)
      const page = await waitForAbortable(
        pdf.getPage(pageNumber),
        options.signal,
      )
      const content = await waitForAbortable(
        page.getTextContent(),
        options.signal,
      )
      const items = content.items.flatMap((item): PdfTextItem[] =>
        'str' in item && item.str
          ? [{
              str: item.str,
              hasEOL: item.hasEOL,
              transform: item.transform,
              height: item.height,
            }]
          : [],
      )
      const lines = reconstructPdfLines(items)
      const height = page.getViewport({ scale: 1 }).height
      const readablePageText = lines.map((line) => line.text).join('\n').trim()
      pages.push({ height, lines })
      pageProxies.push(page as unknown as RenderablePdfPage)
      extractedCharacterCount += readablePageText.length

      if (extractedCharacterCount > MAX_EXTRACTED_CHARACTERS) {
        throw new Error(
          `"${file.name}" contains too much text to review safely in the browser.`,
        )
      }
      reportProgress(options, {
        phase: 'extracting',
        completed: pageNumber,
        total: pdf.numPages,
        pageNumber,
      })
    }

    const cleanedPages = cleanPdfPages(pages)
    const resolvedPages = cleanedPages.map((text) => ({
      text,
      detection: detectPdfText(text, options.localPdfOcr),
      textSource: (text ? 'embedded-text' : 'none') as ExtractedPageSpan['textSource'],
    }))
    const sparsePdfPages = resolvedPages.flatMap((page, index) =>
      page.detection === 'readable-text' ? [] : [index + 1],
    )
    const ocrPages: number[] = []
    const failedOcrPages: number[] = []
    const emptyOcrPages: number[] = []

    if (options.localPdfOcr && sparsePdfPages.length > 0) {
      try {
        reportProgress(options, {
          phase: 'ocr',
          completed: 0,
          total: sparsePdfPages.length,
        })

        for (let index = 0; index < sparsePdfPages.length; index += 1) {
          const pageNumber = sparsePdfPages[index]
          const page = pageProxies[pageNumber - 1]
          try {
            const recognizedText = await waitForAbortable(
              options.localPdfOcr.recognizePage({
                file,
                pageNumber,
                pageCount: pdf.numPages,
                signal: options.signal,
                renderPageImage: (scale) =>
                  renderPdfPageImage(page, options.signal, scale),
              }),
              options.signal,
            )
            const readableOcrText = recognizedText.trim()
            if (readableOcrText) {
              resolvedPages[pageNumber - 1] = {
                ...resolvedPages[pageNumber - 1],
                text: readableOcrText,
                textSource: 'ocr',
              }
              ocrPages.push(pageNumber)
            } else {
              emptyOcrPages.push(pageNumber)
            }
          } catch (cause) {
            if (isAbortError(cause)) throw cause
            failedOcrPages.push(pageNumber)
          }

          reportProgress(options, {
            phase: 'ocr',
            completed: index + 1,
            total: sparsePdfPages.length,
            pageNumber,
          })
        }
      } finally {
        try {
          await options.localPdfOcr.dispose?.()
        } catch {
          // OCR cleanup should not invalidate successfully extracted text.
        }
      }
    }

    const unresolvedSparsePages = sparsePdfPages.filter(
      (pageNumber) => !ocrPages.includes(pageNumber),
    )
    const warnings: DocumentImportWarning[] = []
    if (unresolvedSparsePages.length > 0) {
      warnings.push({
        code: 'sparse-pdf-pages',
        message: `Embedded text was sparse or missing on page${unresolvedSparsePages.length === 1 ? '' : 's'} ${unresolvedSparsePages.join(', ')}.`,
        pageNumbers: unresolvedSparsePages,
      })
    }
    if (failedOcrPages.length > 0) {
      warnings.push({
        code: 'ocr-failed',
        message: `Local OCR failed on page${failedOcrPages.length === 1 ? '' : 's'} ${failedOcrPages.join(', ')}.`,
        pageNumbers: failedOcrPages,
      })
    }
    if (emptyOcrPages.length > 0) {
      warnings.push({
        code: 'ocr-empty',
        message: `Local OCR returned no readable text for page${emptyOcrPages.length === 1 ? '' : 's'} ${emptyOcrPages.join(', ')}.`,
        pageNumbers: emptyOcrPages,
      })
    }

    const joined = joinPdfPageText(resolvedPages)
    if (joined.text.length > MAX_EXTRACTED_CHARACTERS) {
      throw new Error(
        `"${file.name}" contains too much text to review safely in the browser.`,
      )
    }
    if (!joined.text) {
      throw new ScannedPdfError(
        `"${file.name}" appears to be scanned or image-only. Try an import with local PDF OCR enabled.`,
      )
    }

    const usedEmbeddedText = resolvedPages.some(
      (page) => page.text && page.textSource === 'embedded-text',
    )
    const method: PdfExtractionResult['method'] =
      ocrPages.length === 0
        ? 'pdf-text'
        : usedEmbeddedText
          ? 'pdf-mixed'
          : 'pdf-ocr'

      return {
        ...joined,
        pageCount: pdf.numPages,
        sparsePdfPages,
        ocrPages,
        warnings,
        method,
      }
    } finally {
      pageProxies.forEach((page) => page.cleanup?.())
      await pdf.destroy?.()
    }
  } catch (cause) {
    if (
      isAbortError(cause) ||
      cause instanceof ScannedPdfError ||
      cause instanceof DocumentLimitError ||
      (cause instanceof Error && cause.message.includes('too much text'))
    ) {
      throw cause
    }
    throw unreadableFileError(file.name)
  }
}

export async function extractTextFromFile(
  file: File,
  options: DocumentExtractionOptions = {},
): Promise<ExtractedDocument> {
  throwIfAborted(options.signal)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `"${file.name}" is larger than 10 MB. Please choose a smaller file.`,
    )
  }

  const kind = getDocumentKind(file.name)
  if (!kind) {
    throw new Error(
      'Unsupported file type. Please upload a TXT, Markdown, DOCX, or PDF file.',
    )
  }

  let text: string
  let pageCount: number | undefined
  let pageSpans: ExtractedPageSpan[] = []
  let sparsePdfPages: number[] = []
  let ocrPages: number[] = []
  let warnings: DocumentImportWarning[] = []
  let method: DocumentExtractionMethod

  if (kind === 'txt' || kind === 'md') {
    reportProgress(options, { phase: 'reading', completed: 0, total: 1 })
    text = await waitForAbortable(file.text(), options.signal)
    reportProgress(options, { phase: 'reading', completed: 1, total: 1 })
    method = 'plain-text'
  } else if (kind === 'docx') {
    reportProgress(options, { phase: 'reading', completed: 0, total: 1 })
    text = await extractDocxText(file, options)
    reportProgress(options, { phase: 'reading', completed: 1, total: 1 })
    method = 'docx-text'
  } else {
    const pdf = await extractPdfText(file, options)
    text = pdf.text
    pageCount = pdf.pageCount
    pageSpans = pdf.pageSpans
    sparsePdfPages = pdf.sparsePdfPages
    ocrPages = pdf.ocrPages
    warnings = pdf.warnings
    method = pdf.method
  }

  reportProgress(options, { phase: 'finalizing', completed: 0, total: 1 })
  const readableText = text.trim()
  if (readableText.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error(
      `"${file.name}" contains too much text to review safely in the browser.`,
    )
  }
  if (!readableText) {
    throw new Error(`We couldn't find any readable text in "${file.name}".`)
  }

  const source: SourceFileMetadata = {
    name: file.name,
    kind,
    sizeBytes: file.size,
    mimeType: file.type,
    lastModified: file.lastModified,
  }
  const receipt: DocumentImportReceipt = {
    importedAt: (options.importedAt ?? new Date()).toISOString(),
    method,
    characterCount: readableText.length,
    ...(pageCount === undefined ? {} : { pageCount }),
    sparsePdfPages,
    ocrPages,
    warnings,
  }
  reportProgress(options, { phase: 'finalizing', completed: 1, total: 1 })
  reportProgress(options, { phase: 'complete', completed: 1, total: 1 })

  return {
    text: readableText,
    name: file.name,
    kind,
    ...(pageCount === undefined ? {} : { pageCount }),
    source,
    pageSpans,
    receipt,
  }
}
