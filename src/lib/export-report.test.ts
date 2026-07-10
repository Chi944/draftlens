import * as mammoth from 'mammoth'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeText } from './analyzer'
import {
  buildAuditReportDocx,
  downloadAuditReportDocx,
  getAuditReportFilename,
} from './export-report'

const formulaicText = [
  'Moreover, the implementation of a comprehensive framework facilitates the optimization of important processes.',
  'Moreover, the implementation of a comprehensive framework facilitates the optimization of important outcomes.',
  'Furthermore, it is important to note that this holistic approach plays a crucial role in transformation.',
  'In conclusion, it is evident that a robust framework underscores the importance of innovation.',
].join(' ')

const concreteText = [
  'At 6:15 on 14 March, Priya Nair counted 23 crates beside Dock 4.',
  'Two were wet.',
  "I opened the damaged crate with supervisor Luis Ortega and photographed a split seal under the blue plastic strap; the pears inside smelled sour, while the labels showed yesterday's packing date.",
  'We moved those two crates to the cold room, called Northline Logistics, and recorded batch C17 in the warehouse log before noon.',
].join(' ')

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

async function extractRawText(blob: Blob): Promise<string> {
  const arrayBuffer = await blobToArrayBuffer(blob)
  return (await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }))
    .value
}

describe('Word audit export', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('builds a real DOCX with the summary, passage bands, and audited text', async () => {
    const text = Array(7).fill(formulaicText).join(' ')
    const analysis = analyzeText(text)
    const blob = await buildAuditReportDocx({
      text,
      sourceName: 'Independent study 1.1.pdf',
      analysis,
      generatedAt: new Date('2026-07-10T08:30:00Z'),
    })

    const bytes = new Uint8Array(await blobToArrayBuffer(blob))
    const rawText = await extractRawText(blob)

    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]))
    expect(blob.size).toBeGreaterThan(10_000)
    expect(rawText).toContain('Independent study 1.1.pdf')
    expect(rawText).toContain('Audit summary')
    expect(rawText).toMatch(
      new RegExp(
        `Estimated coverage\\s+${analysis.coverage.displayLabel.replace('*', '\\*')}`,
      ),
    )
    expect(rawText).toContain('Review')
    expect(rawText).toContain('Elevated')
    expect(rawText).toContain('Audited document')
    expect(rawText).toMatch(/cannot determine authorship/i)
  })

  it('preserves low-score suppression in the exported summary', async () => {
    const text = [formulaicText, ...Array(4).fill(concreteText)].join(' ')
    const analysis = analyzeText(text)
    const blob = await buildAuditReportDocx({
      text,
      sourceName: 'suppressed.txt',
      analysis,
      generatedAt: new Date('2026-07-10T08:30:00Z'),
    })
    const rawText = await extractRawText(blob)

    expect(analysis.coverage.status).toBe('below-reporting-threshold')
    expect(rawText).toMatch(/Estimated coverage\s+\*%/u)
    expect(rawText).toContain('Passage highlights are withheld below 20%')
  })

  it('creates safe, recognizable Word filenames', () => {
    expect(getAuditReportFilename('Independent study 1.1.pdf')).toBe(
      'Independent study 1.1-DraftLens-audit.docx',
    )
    expect(getAuditReportFilename('bad:<name>?*.docx')).toBe(
      'bad--name----DraftLens-audit.docx',
    )
    expect(getAuditReportFilename('...')).toBe(
      'Untitled-draft-DraftLens-audit.docx',
    )
  })

  it('triggers a client-side Word download with the audited filename', async () => {
    const text = Array(7).fill(formulaicText).join(' ')
    const analysis = analyzeText(text)
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:draftlens-audit')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    let downloadedName = ''
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function captureDownload(this: HTMLAnchorElement) {
        downloadedName = this.download
      })

    await downloadAuditReportDocx({
      text,
      sourceName: 'Independent study 1.1.pdf',
      analysis,
      generatedAt: new Date('2026-07-10T08:30:00Z'),
    })

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(downloadedName).toBe(
      'Independent study 1.1-DraftLens-audit.docx',
    )
    expect(document.querySelector('a[href="blob:draftlens-audit"]')).toBeNull()

    await new Promise((resolve) => window.setTimeout(resolve, 150))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:draftlens-audit')
  })
})
