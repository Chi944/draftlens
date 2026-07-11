import * as mammoth from 'mammoth'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ACCEPTED_FILE_ACCEPT,
  ACCEPTED_FILE_TYPES,
  FILE_ACCEPT,
  accept,
  extractTextFromFile,
} from './document'

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'pdf-worker-url',
}))

function makeTextFile(name: string, text: string): File {
  const file = new File([text], name, { type: 'text/plain' })
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue(text),
  })
  return file
}

function makeBinaryFile(name: string): File {
  const file = new File(['binary'], name)
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  })
  return file
}

function pdfItem(
  str: string,
  x: number,
  y: number,
  hasEOL = false,
) {
  return {
    str,
    hasEOL,
    transform: [1, 0, 0, 1, x, y],
    width: str.length * 6,
    height: 12,
  }
}

describe('document ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports a browser file-input accept value', () => {
    expect(ACCEPTED_FILE_TYPES).toEqual(['.txt', '.md', '.docx', '.pdf'])
    expect(FILE_ACCEPT).toBe('.txt,.md,.docx,.pdf')
    expect(ACCEPTED_FILE_ACCEPT).toBe(FILE_ACCEPT)
    expect(accept).toBe(FILE_ACCEPT)
  })

  it('extracts text files with their name and kind', async () => {
    const file = makeTextFile('report.txt', '  A deliberately written report.\n')
    const importedAt = new Date('2026-07-11T02:00:00Z')
    const document = await extractTextFromFile(file, { importedAt })

    expect(document).toMatchObject({
      text: 'A deliberately written report.',
      name: 'report.txt',
      kind: 'txt',
      source: {
        name: 'report.txt',
        kind: 'txt',
        sizeBytes: file.size,
        mimeType: 'text/plain',
        lastModified: file.lastModified,
      },
      pageSpans: [],
      receipt: {
        importedAt: '2026-07-11T02:00:00.000Z',
        method: 'plain-text',
        characterCount: 30,
        sparsePdfPages: [],
        ocrPages: [],
        warnings: [],
      },
    })
  })

  it('extracts markdown files and accepts uppercase extensions', async () => {
    const file = makeTextFile('NOTES.MD', '# Notes\n\nOriginal analysis')

    await expect(extractTextFromFile(file)).resolves.toMatchObject({
      text: '# Notes\n\nOriginal analysis',
      name: 'NOTES.MD',
      kind: 'md',
    })
  })

  it('extracts raw text from DOCX files in the browser', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({
      value: 'DOCX report text',
      messages: [],
    })

    await expect(
      extractTextFromFile(makeBinaryFile('report.docx')),
    ).resolves.toMatchObject({
      text: 'DOCX report text',
      name: 'report.docx',
      kind: 'docx',
    })
  })

  it('extracts every PDF page and reports the page count', async () => {
    const getTextContent = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { str: 'First' },
          { str: 'page', hasEOL: true },
          { str: 'New line' },
        ],
      })
      .mockResolvedValueOnce({ items: [{ str: 'Second page' }] })
    const getPage = vi.fn().mockImplementation(() => ({
      getTextContent,
      getViewport: () => ({ height: 800 }),
    }))

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    const document = await extractTextFromFile(makeBinaryFile('report.pdf'))

    expect(document).toMatchObject({
      text: 'First page\nNew line\n\nSecond page',
      name: 'report.pdf',
      kind: 'pdf',
      pageCount: 2,
    })
    const firstPageText = 'First page\nNew line'
    expect(document.pageSpans).toEqual([
      {
        pageNumber: 1,
        start: 0,
        end: firstPageText.length,
        textSource: 'embedded-text',
        detection: 'sparse-text',
      },
      {
        pageNumber: 2,
        start: firstPageText.length + 2,
        end: document.text.length,
        textSource: 'embedded-text',
        detection: 'sparse-text',
      },
    ])
    expect(document.receipt).toMatchObject({
      method: 'pdf-text',
      characterCount: document.text.length,
      pageCount: 2,
      sparsePdfPages: [1, 2],
      ocrPages: [],
    })
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(GlobalWorkerOptions.workerSrc).toBe('pdf-worker-url')
  })

  it('reconstructs physical PDF lines when hasEOL is false', async () => {
    const getTextContent = vi.fn().mockResolvedValue({
      items: [
        pdfItem('TABLE OF CONTENTS', 100, 720),
        pdfItem('Research Objectives', 100, 690),
        pdfItem('................................', 230, 690),
        pdfItem('vi', 430, 690),
        pdfItem('Body sentence begins here.', 100, 650),
      ],
    })
    const getPage = vi.fn().mockResolvedValue({
      getTextContent,
      getViewport: () => ({ height: 800 }),
    })

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    await expect(
      extractTextFromFile(makeBinaryFile('contents.pdf')),
    ).resolves.toMatchObject({
      text: [
        'TABLE OF CONTENTS',
        'Research Objectives................................ vi',
        'Body sentence begins here.',
      ].join('\n'),
      name: 'contents.pdf',
      kind: 'pdf',
      pageCount: 1,
    })
  })

  it('removes repeated boundary artifacts without removing the same body text', async () => {
    const pageContents = [
      {
        items: [
          pdfItem('University of Example', 100, 400),
          pdfItem('i', 300, 50),
          pdfItem('University of Example', 420, 30),
        ],
      },
      {
        items: [
          pdfItem('Body sentence on page two.', 100, 650),
          pdfItem('2', 100, 760),
          pdfItem('University of Example', 420, 30),
        ],
      },
    ]
    const getPage = vi.fn().mockImplementation((pageNumber: number) => ({
      getTextContent: () => Promise.resolve(pageContents[pageNumber - 1]),
      getViewport: () => ({ height: 800 }),
    }))

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    const document = await extractTextFromFile(makeBinaryFile('paged.pdf'))

    expect(document).toMatchObject({
      text: 'University of Example\n\nBody sentence on page two.',
      name: 'paged.pdf',
      kind: 'pdf',
      pageCount: 2,
    })
    expect(document.text.match(/University of Example/gu)).toHaveLength(1)
    expect(document.text).not.toMatch(/^(?:i|2)$/gimu)
  })

  it('detects image-only PDF pages and uses explicitly supplied local OCR', async () => {
    const pageContents = [
      {
        items: [
          pdfItem(
            'This embedded paragraph has enough readable words to remain unchanged.',
            100,
            650,
          ),
        ],
      },
      { items: [] },
    ]
    const getPage = vi.fn().mockImplementation((pageNumber: number) => ({
      getTextContent: () => Promise.resolve(pageContents[pageNumber - 1]),
      getViewport: () => ({ width: 600, height: 800 }),
    }))
    const recognizePage = vi
      .fn()
      .mockResolvedValue('Recovered scanned page text with sufficient detail.')
    const dispose = vi.fn().mockResolvedValue(undefined)

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    const document = await extractTextFromFile(
      makeBinaryFile('mixed.pdf'),
      { localPdfOcr: { recognizePage, dispose } },
    )

    expect(recognizePage).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(recognizePage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNumber: 2,
        pageCount: 2,
        renderPageImage: expect.any(Function),
      }),
    )
    expect(document.text).toContain('Recovered scanned page text')
    expect(document.pageSpans).toEqual([
      {
        pageNumber: 1,
        start: 0,
        end: pageContents[0].items[0].str.length,
        textSource: 'embedded-text',
        detection: 'readable-text',
      },
      {
        pageNumber: 2,
        start: pageContents[0].items[0].str.length + 2,
        end: document.text.length,
        textSource: 'ocr',
        detection: 'image-only',
      },
    ])
    expect(document.receipt).toMatchObject({
      method: 'pdf-mixed',
      pageCount: 2,
      sparsePdfPages: [2],
      ocrPages: [2],
      warnings: [],
    })
  })

  it('reports unresolved sparse pages without silently dropping the readable pages', async () => {
    const getPage = vi.fn().mockImplementation((pageNumber: number) => ({
      getTextContent: () =>
        Promise.resolve({
          items:
            pageNumber === 1
              ? [
                  pdfItem(
                    'This page contains a complete readable paragraph for review.',
                    100,
                    650,
                  ),
                ]
              : [],
        }),
      getViewport: () => ({ width: 600, height: 800 }),
    }))

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    const document = await extractTextFromFile(makeBinaryFile('partial-scan.pdf'))

    expect(document.text).toContain('complete readable paragraph')
    expect(document.pageSpans[1]).toEqual({
      pageNumber: 2,
      start: document.text.length,
      end: document.text.length,
      textSource: 'none',
      detection: 'image-only',
    })
    expect(document.receipt.warnings).toEqual([
      {
        code: 'sparse-pdf-pages',
        message: 'Embedded text was sparse or missing on page 2.',
        pageNumbers: [2],
      },
    ])
  })

  it('gives scanned PDFs a specific OCR-ready error', async () => {
    const getPage = vi.fn().mockResolvedValue({
      getTextContent: () => Promise.resolve({ items: [] }),
      getViewport: () => ({ width: 600, height: 800 }),
    })

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    await expect(
      extractTextFromFile(makeBinaryFile('scan.pdf')),
    ).rejects.toThrow('appears to be scanned or image-only')

    const recovered = await extractTextFromFile(makeBinaryFile('scan.pdf'), {
      localPdfOcr: {
        recognizePage: vi
          .fn()
          .mockResolvedValue('OCR recovered this fully scanned document page.'),
      },
    })
    expect(recovered.receipt).toMatchObject({
      method: 'pdf-ocr',
      sparsePdfPages: [1],
      ocrPages: [1],
      warnings: [],
    })
    expect(recovered.pageSpans[0]).toMatchObject({
      textSource: 'ocr',
      detection: 'image-only',
    })
  })

  it('reports page progress and cooperatively cancels PDF extraction', async () => {
    const controller = new AbortController()
    const getPage = vi.fn().mockResolvedValue({
      getTextContent: () =>
        Promise.resolve({
          items: [
            pdfItem(
              'A complete readable paragraph appears on this extracted page.',
              100,
              650,
            ),
          ],
        }),
      getViewport: () => ({ width: 600, height: 800 }),
    })

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 3, getPage }),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>)

    await expect(
      extractTextFromFile(makeBinaryFile('cancel.pdf'), {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'extracting' && progress.completed === 1) {
            controller.abort()
          }
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(getPage).toHaveBeenCalledTimes(1)
  })

  it('does not read a file when extraction is already cancelled', async () => {
    const controller = new AbortController()
    const file = makeTextFile('cancelled.txt', 'Never read this text.')
    controller.abort()

    await expect(
      extractTextFromFile(file, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(file.text).not.toHaveBeenCalled()
  })

  it('emits a complete progress sequence for text extraction', async () => {
    const progress: Array<{ phase: string; completed: number }> = []

    await extractTextFromFile(makeTextFile('progress.txt', 'Readable text.'), {
      onProgress: (update) => {
        progress.push({ phase: update.phase, completed: update.completed })
      },
    })

    expect(progress).toEqual([
      { phase: 'reading', completed: 0 },
      { phase: 'reading', completed: 1 },
      { phase: 'finalizing', completed: 0 },
      { phase: 'finalizing', completed: 1 },
      { phase: 'complete', completed: 1 },
    ])
  })

  it('rejects unsupported extensions before reading the file', async () => {
    const file = makeTextFile('report.rtf', 'text')

    await expect(extractTextFromFile(file)).rejects.toThrow(
      'Unsupported file type',
    )
    expect(file.text).not.toHaveBeenCalled()
  })

  it('rejects files larger than 10 MB', async () => {
    const file = makeTextFile('report.txt', 'text')
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })

    await expect(extractTextFromFile(file)).rejects.toThrow('larger than 10 MB')
  })

  it('rejects files without readable text', async () => {
    const file = makeTextFile('empty.md', ' \n\t ')

    await expect(extractTextFromFile(file)).rejects.toThrow(
      'couldn\'t find any readable text',
    )
  })

  it('uses a friendly error for password-protected or broken documents', async () => {
    vi.mocked(mammoth.extractRawText).mockRejectedValue(
      new Error('Could not find the end of central directory'),
    )

    await expect(
      extractTextFromFile(makeBinaryFile('broken.docx')),
    ).rejects.toThrow('password-protected or damaged')
  })
})
