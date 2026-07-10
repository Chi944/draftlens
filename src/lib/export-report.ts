import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LineRuleType,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from 'docx'

import { PASSAGE_BANDS, passageBandLabel } from './passage-bands'
import type { AnalysisResult, FlaggedPassage } from './types'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// standard_business_brief tokens, with named DraftLens highlight overrides.
const PAGE_WIDTH = 12_240
const PAGE_HEIGHT = 15_840
const PAGE_MARGIN = 1_440
const HEADER_FOOTER_DISTANCE = 708
const CONTENT_WIDTH = 9_360
const TABLE_INDENT = 120
const TABLE_LABEL_WIDTH = 2_700
const TABLE_VALUE_WIDTH = 6_660
const BODY_LINE_SPACING = 264
const TABLE_LINE_SPACING = 264
const BODY_AFTER = 120
const INK = '24333F'
const MUTED = '66727C'
const HEADING_BLUE = '2E74B5'
const HEADING_DARK_BLUE = '1F4D78'
const INK_BLUE = '1F3A5F'
const TABLE_FILL = 'F2F4F7'
const CALLOUT_FILL = 'F4F6F9'
const BORDER = 'D9DEE5'
const REVIEW_FILL = 'FFF2CC'
const REVIEW_INK = '7A5A00'
const ELEVATED_FILL = 'FCE8E6'
const ELEVATED_INK = '9B1C1C'

const TABLE_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: BORDER,
}

export interface AuditReportInput {
  text: string
  sourceName: string
  analysis: AnalysisResult
  generatedAt?: Date
}

function cleanDocxText(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 || code === 9 || code === 10 || code === 13
    })
    .join('')
}

function compactText(value: string): string {
  return cleanDocxText(value).replace(/\s+/gu, ' ').trim()
}

function truncate(value: string, maximum = 520): string {
  const compact = compactText(value)
  if (compact.length <= maximum) return compact

  const candidate = compact.slice(0, maximum + 1)
  const boundary = candidate.lastIndexOf(' ')
  return `${candidate.slice(0, boundary > maximum * 0.7 ? boundary : maximum).trim()}...`
}

function formatGeneratedAt(value: Date): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(value)

  return `${date} UTC`
}

function coverageResultLabel(analysis: AnalysisResult): string {
  if (analysis.coverage.status === 'insufficient-prose') {
    return 'Not enough qualifying prose'
  }
  if (analysis.coverage.status === 'out-of-range') {
    return 'Outside the supported range'
  }
  if (analysis.coverage.status === 'below-reporting-threshold') {
    return 'Below reporting threshold'
  }
  if (analysis.classification === 'high') return 'High estimated coverage'
  if (analysis.classification === 'mixed') {
    return 'Reviewable estimated coverage'
  }
  return 'No detected coverage'
}

function auditTitle(sourceName: string): string {
  return `${cleanDocxText(sourceName)} - DraftLens writing-pattern audit`
}

export function getAuditReportFilename(sourceName: string): string {
  const withoutKnownExtension = sourceName.replace(
    /\.(?:pdf|docx?|txt|md)$/iu,
    '',
  )
  const safeBase = cleanDocxText(withoutKnownExtension)
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .trim()
    .slice(0, 100)

  return `${safeBase || 'Untitled-draft'}-DraftLens-audit.docx`
}

function bandColors(classification: FlaggedPassage['classification']) {
  return classification === 'high'
    ? { fill: ELEVATED_FILL, ink: ELEVATED_INK }
    : { fill: REVIEW_FILL, ink: REVIEW_INK }
}

function tableParagraph(children: ParagraphChild[]): Paragraph {
  return new Paragraph({
    children,
    spacing: {
      before: 0,
      after: 0,
      line: TABLE_LINE_SPACING,
      lineRule: LineRuleType.AUTO,
    },
  })
}

function summaryRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: TABLE_LABEL_WIDTH, type: WidthType.DXA },
        margins: {
          top: 80,
          bottom: 80,
          left: 120,
          right: 120,
          marginUnitType: WidthType.DXA,
        },
        shading: { type: ShadingType.CLEAR, fill: TABLE_FILL },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          tableParagraph([
            new TextRun({ text: label, bold: true, color: INK_BLUE }),
          ]),
        ],
      }),
      new TableCell({
        width: { size: TABLE_VALUE_WIDTH, type: WidthType.DXA },
        margins: {
          top: 80,
          bottom: 80,
          left: 120,
          right: 120,
          marginUnitType: WidthType.DXA,
        },
        verticalAlign: VerticalAlign.CENTER,
        children: [tableParagraph([new TextRun(cleanDocxText(value))])],
      }),
    ],
  })
}

function buildSummaryTable(analysis: AnalysisResult): Table {
  const confidence = `${analysis.confidence.label} (${analysis.confidence.score}/100) - ${analysis.confidence.reason}`

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: TABLE_INDENT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [TABLE_LABEL_WIDTH, TABLE_VALUE_WIDTH],
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120,
      marginUnitType: WidthType.DXA,
    },
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    rows: [
      summaryRow('Estimated coverage', analysis.coverage.displayLabel),
      summaryRow('Result', coverageResultLabel(analysis)),
      summaryRow('Estimate confidence', confidence),
      summaryRow(
        'Qualifying prose words',
        analysis.stats.qualifyingWordCount.toLocaleString('en-US'),
      ),
      summaryRow(
        'Words in detected passages',
        analysis.stats.detectedWordCount.toLocaleString('en-US'),
      ),
      summaryRow(
        'Excluded non-prose words',
        analysis.stats.excludedWordCount.toLocaleString('en-US'),
      ),
      summaryRow('Pattern intensity', `${analysis.patternIntensity}/100`),
      summaryRow(
        'Reported passages',
        analysis.flaggedPassages.length.toLocaleString('en-US'),
      ),
      summaryRow(
        'Calibration profile',
        analysis.methodology.profileId ?? 'Not specified',
      ),
    ],
  })
}

function bandDefinitionParagraph(
  classification: FlaggedPassage['classification'],
): Paragraph {
  const colors = bandColors(classification)
  const band = PASSAGE_BANDS[classification]

  return new Paragraph({
    children: [
      new TextRun({
        text: ` ${band.label} `,
        bold: true,
        color: colors.ink,
        shading: { type: ShadingType.CLEAR, fill: colors.fill },
      }),
      new TextRun(`  ${band.definition}`),
    ],
  })
}

function passageReviewChildren(
  passage: FlaggedPassage,
  index: number,
): FileChild[] {
  const colors = bandColors(passage.classification)
  const children: FileChild[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun(
          `Passage ${index + 1} - ${passageBandLabel(passage.classification)}`,
        ),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Weighted local estimate: ', bold: true }),
        new TextRun({
          text: `${passage.score}/100`,
          bold: true,
          color: colors.ink,
        }),
      ],
    }),
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: colors.fill },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          color: colors.ink,
          size: 14,
          space: 8,
        },
      },
      spacing: {
        before: 40,
        after: 140,
        line: BODY_LINE_SPACING,
        lineRule: LineRuleType.AUTO,
      },
      children: [
        new TextRun({
          text: truncate(passage.text),
          italics: true,
          color: INK,
        }),
      ],
    }),
  ]

  passage.signals.slice(0, 3).forEach((signal) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${signal.label}: `, bold: true }),
          new TextRun(cleanDocxText(signal.description)),
        ],
      }),
    )
    if (signal.evidence.length > 0) {
      children.push(
        new Paragraph({
          style: 'AuditNote',
          children: [
            new TextRun({ text: 'Observed: ', bold: true }),
            new TextRun(
              truncate(signal.evidence.slice(0, 2).join(' | '), 360),
            ),
          ],
        }),
      )
    }
  })

  return children
}

function runsForSourceRange(
  text: string,
  start: number,
  end: number,
  passages: FlaggedPassage[],
): TextRun[] {
  const boundaries = new Set([start, end])

  passages.forEach((passage) => {
    if (passage.end <= start || passage.start >= end) return
    boundaries.add(Math.max(start, passage.start))
    boundaries.add(Math.min(end, passage.end))
  })

  const ordered = [...boundaries].sort((left, right) => left - right)
  const runs: TextRun[] = []

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const rangeStart = ordered[index]
    const rangeEnd = ordered[index + 1]
    const value = cleanDocxText(
      text.slice(rangeStart, rangeEnd).replace(/\s*\r?\n\s*/gu, ' '),
    )
    if (!value) continue

    const passage = passages.find(
      (candidate) =>
        candidate.start < rangeEnd && candidate.end > rangeStart,
    )
    if (!passage) {
      runs.push(new TextRun(value))
      continue
    }

    const colors = bandColors(passage.classification)
    runs.push(
      new TextRun({
        text: value,
        color: colors.ink,
        shading: { type: ShadingType.CLEAR, fill: colors.fill },
      }),
    )
  }

  return runs
}

function highlightedSourceParagraphs(
  text: string,
  passages: FlaggedPassage[],
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const paragraphBreak = /\r?\n(?:[\t ]*\r?\n)+/gu
  let start = 0

  const addParagraph = (end: number) => {
    const runs = runsForSourceRange(text, start, end, passages)
    if (runs.length > 0) {
      paragraphs.push(
        new Paragraph({
          widowControl: true,
          children: runs,
        }),
      )
    }
  }

  for (const match of text.matchAll(paragraphBreak)) {
    const matchStart = match.index ?? start
    addParagraph(matchStart)
    start = matchStart + match[0].length
  }
  addParagraph(text.length)

  return paragraphs.length > 0
    ? paragraphs
    : [new Paragraph({ children: [new TextRun('No readable text.')] })]
}

function buildDocumentChildren(input: AuditReportInput): FileChild[] {
  const { analysis, sourceName, text } = input
  const generatedAt = input.generatedAt ?? new Date()
  const children: FileChild[] = [
    new Paragraph({
      style: 'AuditKicker',
      children: [new TextRun('DRAFTLENS / WRITING-PATTERN AUDIT')],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun('Writing-pattern audit')],
    }),
    new Paragraph({
      style: 'AuditSubtitle',
      children: [new TextRun(cleanDocxText(sourceName))],
    }),
    new Paragraph({
      style: 'AuditMeta',
      children: [
        new TextRun({ text: 'Generated: ', bold: true }),
        new TextRun(formatGeneratedAt(generatedAt)),
      ],
    }),
    new Paragraph({
      style: 'AuditMeta',
      children: [
        new TextRun({ text: 'Method: ', bold: true }),
        new TextRun(cleanDocxText(analysis.methodology.name)),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Audit summary')],
    }),
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: CALLOUT_FILL },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          color: HEADING_BLUE,
          size: 14,
          space: 8,
        },
      },
      spacing: {
        before: 0,
        after: 160,
        line: BODY_LINE_SPACING,
        lineRule: LineRuleType.AUTO,
      },
      children: [
        new TextRun({ text: 'Interpret with care. ', bold: true }),
        new TextRun(
          'This is an independent writing-pattern estimate. It cannot determine authorship or prove that AI wrote any passage.',
        ),
      ],
    }),
    buildSummaryTable(analysis),
    new Paragraph({ spacing: { before: 0, after: 40 }, children: [] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Passage bands')],
    }),
    bandDefinitionParagraph('mixed'),
    bandDefinitionParagraph('high'),
    new Paragraph({
      style: 'AuditNote',
      children: [
        new TextRun(
          'Both bands count equally toward detected-word coverage. They are review cues, not authorship findings.',
        ),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Detected-passage review')],
    }),
  ]

  if (analysis.flaggedPassages.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun(
            analysis.coverage.status === 'below-reporting-threshold'
              ? 'Passage highlights are withheld below 20% because isolated highlights carry a higher false-positive risk.'
              : 'No reportable passage highlights were produced for this result.',
          ),
        ],
      }),
    )
  } else {
    analysis.flaggedPassages.forEach((passage, index) => {
      children.push(...passageReviewChildren(passage, index))
    })
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun('Audited document')],
    }),
    new Paragraph({
      style: 'AuditNote',
      children: [
        new TextRun({
          text: ' Review ',
          bold: true,
          color: REVIEW_INK,
          shading: { type: ShadingType.CLEAR, fill: REVIEW_FILL },
        }),
        new TextRun('  closer to the calibrated threshold    '),
        new TextRun({
          text: ' Elevated ',
          bold: true,
          color: ELEVATED_INK,
          shading: { type: ShadingType.CLEAR, fill: ELEVATED_FILL },
        }),
        new TextRun('  stronger local match'),
      ],
    }),
    ...highlightedSourceParagraphs(text, analysis.flaggedPassages),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun('Method and limitations')],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Method. ', bold: true }),
        new TextRun(cleanDocxText(analysis.methodology.description)),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Score meaning. ', bold: true }),
        new TextRun(cleanDocxText(analysis.methodology.scoreMeaning)),
      ],
    }),
  )

  analysis.limitations.forEach((limitation) => {
    children.push(
      new Paragraph({
        style: 'AuditNote',
        children: [new TextRun(cleanDocxText(limitation))],
      }),
    )
  })

  return children
}

function createAuditFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: 'DraftLens audit  |  Page ',
            font: 'Calibri',
            size: 17,
            color: MUTED,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: 'Calibri',
            size: 17,
            color: MUTED,
          }),
        ],
      }),
    ],
  })
}

export function createAuditReportDocument(input: AuditReportInput): Document {
  const safeSourceName = cleanDocxText(input.sourceName)

  return new Document({
    creator: 'DraftLens',
    lastModifiedBy: 'DraftLens',
    title: auditTitle(safeSourceName),
    subject: 'Independent writing-pattern audit',
    description:
      'A local DraftLens writing-pattern estimate with passage-level evidence and limitations.',
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: INK },
          paragraph: {
            spacing: {
              before: 0,
              after: BODY_AFTER,
              line: BODY_LINE_SPACING,
              lineRule: LineRuleType.AUTO,
            },
          },
        },
        title: {
          run: { font: 'Calibri', size: 52, bold: true, color: INK_BLUE },
          paragraph: {
            spacing: { before: 0, after: 80 },
            keepNext: true,
          },
        },
        heading1: {
          run: { font: 'Calibri', size: 32, bold: true, color: HEADING_BLUE },
          paragraph: {
            spacing: { before: 320, after: 160 },
            keepNext: true,
          },
        },
        heading2: {
          run: { font: 'Calibri', size: 26, bold: true, color: HEADING_BLUE },
          paragraph: {
            spacing: { before: 240, after: 120 },
            keepNext: true,
          },
        },
        heading3: {
          run: {
            font: 'Calibri',
            size: 24,
            bold: true,
            color: HEADING_DARK_BLUE,
          },
          paragraph: {
            spacing: { before: 160, after: 80 },
            keepNext: true,
          },
        },
      },
      paragraphStyles: [
        {
          id: 'AuditKicker',
          name: 'Audit Kicker',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            font: 'Calibri',
            size: 18,
            bold: true,
            allCaps: true,
            color: HEADING_BLUE,
            characterSpacing: 18,
          },
          paragraph: { spacing: { before: 0, after: 80 }, keepNext: true },
        },
        {
          id: 'AuditSubtitle',
          name: 'Audit Subtitle',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: 'Calibri', size: 28, color: MUTED },
          paragraph: { spacing: { before: 0, after: 240 }, keepNext: true },
        },
        {
          id: 'AuditMeta',
          name: 'Audit Metadata',
          basedOn: 'Normal',
          next: 'AuditMeta',
          run: { font: 'Calibri', size: 19, color: MUTED },
          paragraph: {
            spacing: {
              before: 0,
              after: 40,
              line: BODY_LINE_SPACING,
              lineRule: LineRuleType.AUTO,
            },
          },
        },
        {
          id: 'AuditNote',
          name: 'Audit Note',
          basedOn: 'Normal',
          next: 'AuditNote',
          run: { font: 'Calibri', size: 20, color: MUTED },
          paragraph: {
            spacing: {
              before: 0,
              after: 100,
              line: BODY_LINE_SPACING,
              lineRule: LineRuleType.AUTO,
            },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: PAGE_WIDTH,
              height: PAGE_HEIGHT,
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: PAGE_MARGIN,
              right: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
              header: HEADER_FOOTER_DISTANCE,
              footer: HEADER_FOOTER_DISTANCE,
              gutter: 0,
            },
          },
        },
        footers: {
          default: createAuditFooter(),
        },
        children: buildDocumentChildren({
          ...input,
          sourceName: safeSourceName,
        }),
      },
    ],
  })
}

export async function buildAuditReportDocx(
  input: AuditReportInput,
): Promise<Blob> {
  const blob = await Packer.toBlob(createAuditReportDocument(input))
  return blob.type === DOCX_MIME
    ? blob
    : new Blob([blob], { type: DOCX_MIME })
}

export async function downloadAuditReportDocx(
  input: AuditReportInput,
): Promise<void> {
  const blob = await buildAuditReportDocx(input)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = getAuditReportFilename(input.sourceName)
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 100)
}
