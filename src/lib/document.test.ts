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

    await expect(extractTextFromFile(file)).resolves.toEqual({
      text: 'A deliberately written report.',
      name: 'report.txt',
      kind: 'txt',
    })
  })

  it('extracts markdown files and accepts uppercase extensions', async () => {
    const file = makeTextFile('NOTES.MD', '# Notes\n\nOriginal analysis')

    await expect(extractTextFromFile(file)).resolves.toEqual({
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
    ).resolves.toEqual({
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
    const getPage = vi.fn().mockImplementation(() => ({ getTextContent }))

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    } as unknown as ReturnType<typeof getDocument>)

    await expect(
      extractTextFromFile(makeBinaryFile('report.pdf')),
    ).resolves.toEqual({
      text: 'First page\nNew line\n\nSecond page',
      name: 'report.pdf',
      kind: 'pdf',
      pageCount: 2,
    })
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(GlobalWorkerOptions.workerSrc).toBe('pdf-worker-url')
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
