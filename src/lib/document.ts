/// <reference types="vite/client" />

export const ACCEPTED_FILE_TYPES = ['.txt', '.md', '.docx', '.pdf'] as const
export const FILE_ACCEPT = ACCEPTED_FILE_TYPES.join(',')
export const ACCEPTED_FILE_ACCEPT = FILE_ACCEPT
export const accept = FILE_ACCEPT

export type DocumentKind = 'txt' | 'md' | 'docx' | 'pdf'

export interface ExtractedDocument {
  text: string
  name: string
  kind: DocumentKind
  pageCount?: number
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_EXTRACTED_CHARACTERS = 2_000_000
const SUPPORTED_KINDS = new Set<DocumentKind>(['txt', 'md', 'docx', 'pdf'])

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

async function extractDocxText(file: File): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value
  } catch {
    throw unreadableFileError(file.name)
  }
}

async function extractPdfText(
  file: File,
): Promise<{ text: string; pageCount: number }> {
  try {
    const [{ GlobalWorkerOptions, getDocument }, { default: pdfWorkerUrl }] =
      await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await getDocument({ data }).promise
    const pages: string[] = []
    let extractedCharacterCount = 0

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let pageText = ''

      content.items.forEach((item) => {
        if (!('str' in item) || !item.str) return

        const needsSpace =
          pageText.length > 0 &&
          !/[\s([{]$/u.test(pageText) &&
          !/^[,.;:!?)}\]]/u.test(item.str)
        pageText += `${needsSpace ? ' ' : ''}${item.str}`
        if (item.hasEOL) pageText += '\n'
      })

      const readablePageText = pageText.trim()
      pages.push(readablePageText)
      extractedCharacterCount += readablePageText.length

      if (extractedCharacterCount > MAX_EXTRACTED_CHARACTERS) {
        throw new Error(
          `"${file.name}" contains too much text to review safely in the browser.`,
        )
      }
    }

    return { text: pages.join('\n\n'), pageCount: pdf.numPages }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('too much text')) {
      throw cause
    }
    throw unreadableFileError(file.name)
  }
}

export async function extractTextFromFile(
  file: File,
): Promise<ExtractedDocument> {
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

  if (kind === 'txt' || kind === 'md') {
    text = await file.text()
  } else if (kind === 'docx') {
    text = await extractDocxText(file)
  } else {
    const pdf = await extractPdfText(file)
    text = pdf.text
    pageCount = pdf.pageCount
  }

  const readableText = text.trim()
  if (readableText.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error(
      `"${file.name}" contains too much text to review safely in the browser.`,
    )
  }
  if (!readableText) {
    throw new Error(`We couldn't find any readable text in "${file.name}".`)
  }

  return {
    text: readableText,
    name: file.name,
    kind,
    ...(pageCount === undefined ? {} : { pageCount }),
  }
}
