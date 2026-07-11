import * as mammoth from 'mammoth'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeText } from './analyzer'
import {
  buildAuditReportDocx,
  buildCleanDocumentDocx,
  buildHighlightedEvidenceDocx,
  downloadAuditReportDocx,
  downloadCleanDocumentDocx,
  downloadHighlightedEvidenceDocx,
  getAuditReportFilename,
  getCleanDocumentFilename,
  getHighlightedEvidenceFilename,
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

const unsupportedAcademicText = Array(4)
  .fill(
    [
      'Spectrophotometric quantification demonstrated substantial intracellular phosphorylation after thermodynamic stabilization of the recombinant microorganism culture.',
      'Chromatographic characterization separated the polyunsaturated metabolites before immunohistochemical examination of mitochondrial membranes.',
      'The experimental methodology incorporated triplicate measurements, temperature-controlled centrifugation, and preregistered exclusion criteria for contaminated observations.',
      'Researchers documented concentration-dependent differentiation across the longitudinal intervention groups without substituting unverified interpretations for recorded measurements.',
      'Heteroscedasticity diagnostics supported logarithmic transformation before multivariable regression, although confidence intervals remained comparatively wide.',
      'Independent replication identified comparable electrophysiological associations in geographically separated populations.',
      'These observations constrain generalization because institutional recruitment excluded participants with cardiometabolic contraindications.',
    ].join(' '),
  )
  .join(' ')

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
        `Flagged prose coverage\\s+${analysis.coverage.displayLabel.replace('*', '\\*')}`,
      ),
    )
    expect(rawText).toContain('Review')
    expect(rawText).toContain('Elevated')
    expect(rawText).toContain('Audited document')
    expect(rawText).toContain('What moved the estimate')
    expect(rawText).toMatch(/raised the model log-odds|lowered the model log-odds/iu)
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
    expect(rawText).toMatch(/Flagged prose coverage\s+\*%/u)
    expect(rawText).toContain('Passage highlights are withheld below 20%')
  })

  it('labels unsupported-domain audits without falling through to a high-coverage result', async () => {
    const analysis = analyzeText(unsupportedAcademicText)
    expect(analysis.coverage.status).toBe('unsupported-domain')
    expect(analysis.coverage.rawPercent).toBeGreaterThanOrEqual(80)

    const [auditText, evidenceText] = await Promise.all([
      buildAuditReportDocx({
        text: unsupportedAcademicText,
        sourceName: 'technical-study.docx',
        analysis,
        generatedAt: new Date('2026-07-10T08:30:00Z'),
      }).then(extractRawText),
      buildHighlightedEvidenceDocx({
        text: unsupportedAcademicText,
        sourceName: 'technical-study.docx',
        analysis,
        generatedAt: new Date('2026-07-10T08:30:00Z'),
      }).then(extractRawText),
    ])

    expect(auditText).toMatch(
      /Result\s+No result - outside calibrated domain/iu,
    )
    expect(auditText).toMatch(/Domain-check reason\s+Long-word share/iu)
    expect(auditText).toContain(
      'Not reported outside calibrated domain',
    )
    expect(auditText).not.toContain('High flagged coverage')
    expect(evidenceText).toContain('No highlighting is reported')
    expect(evidenceText).toMatch(/exact coverage score and passage highlights are withheld/iu)
  })

  it('builds a clean revised document without audit labels or highlighting copy', async () => {
    const text = `${concreteText}\n\n${concreteText}`
    const blob = await buildCleanDocumentDocx({
      text,
      sourceName: 'Revised independent study.docx',
    })
    const rawText = await extractRawText(blob)

    expect(rawText).toContain('At 6:15 on 14 March')
    expect(rawText).toContain('recorded batch C17')
    expect(rawText).not.toContain('DraftLens')
    expect(rawText).not.toContain('Flagged prose coverage')
    expect(rawText).not.toContain('Review')
    expect(rawText).not.toContain('Elevated')
  })

  it('preserves single-line structure for pasted text and Markdown clean exports', async () => {
    const text = 'Study notes\n- First observation\n- Second observation\nClosing paragraph.'
    const blob = await buildCleanDocumentDocx({
      text,
      sourceName: 'notes.md',
      preserveSingleLineBreaks: true,
    })
    const rawText = await extractRawText(blob)

    expect(rawText).toContain(
      'Study notes\n\n- First observation\n\n- Second observation\n\nClosing paragraph.',
    )
  })

  it('builds a separate highlighted evidence document with optional source-page references', async () => {
    const text = Array(7).fill(formulaicText).join(' ')
    const analysis = analyzeText(text)
    const firstPassage = analysis.flaggedPassages[0]
    expect(firstPassage).toBeDefined()

    const blob = await buildHighlightedEvidenceDocx({
      text,
      sourceName: 'Independent study 1.1.pdf',
      analysis,
      generatedAt: new Date('2026-07-10T08:30:00Z'),
      passagePageReferences: firstPassage
        ? { [firstPassage.id]: 12 }
        : undefined,
    })
    const rawText = await extractRawText(blob)

    expect(rawText).toContain('Highlighted evidence document')
    expect(rawText).toContain('Highlighted document')
    expect(rawText).toContain('Passage evidence notes')
    expect(rawText).toMatch(/evidence of a writing pattern, not proof/i)
    expect(rawText).toMatch(/Passage 1.+source page 12/iu)
    expect(rawText).toMatch(/signed statistical factors that caused the model score/iu)
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
    expect(getCleanDocumentFilename('Independent study 1.1.pdf')).toBe(
      'Independent study 1.1-revised.docx',
    )
    expect(getHighlightedEvidenceFilename('Independent study 1.1.pdf')).toBe(
      'Independent study 1.1-DraftLens-evidence.docx',
    )
  })

  it('triggers distinct client-side downloads for all three Word exports', async () => {
    const text = Array(7).fill(formulaicText).join(' ')
    const analysis = analyzeText(text)
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:draftlens-audit')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const downloadedNames: string[] = []
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function captureDownload(this: HTMLAnchorElement) {
        downloadedNames.push(this.download)
      })

    await downloadAuditReportDocx({
      text,
      sourceName: 'Independent study 1.1.pdf',
      analysis,
      generatedAt: new Date('2026-07-10T08:30:00Z'),
    })
    await downloadCleanDocumentDocx({
      text,
      sourceName: 'Independent study 1.1.pdf',
    })
    await downloadHighlightedEvidenceDocx({
      text,
      sourceName: 'Independent study 1.1.pdf',
      analysis,
      generatedAt: new Date('2026-07-10T08:30:00Z'),
    })

    expect(createObjectUrl).toHaveBeenCalledTimes(3)
    expect(click).toHaveBeenCalledTimes(3)
    expect(downloadedNames).toEqual([
      'Independent study 1.1-DraftLens-audit.docx',
      'Independent study 1.1-revised.docx',
      'Independent study 1.1-DraftLens-evidence.docx',
    ])
    expect(document.querySelector('a[href="blob:draftlens-audit"]')).toBeNull()

    await new Promise((resolve) => window.setTimeout(resolve, 150))
    expect(revokeObjectUrl).toHaveBeenCalledTimes(3)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:draftlens-audit')
  })
})
