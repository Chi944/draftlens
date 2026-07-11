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
import type { AnalysisResult, FlaggedPassage, ModelFactor } from './types'

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
  passagePageReferences?: Readonly<Record<string, number>>
}

export interface CleanDocumentInput {
  text: string
  sourceName: string
  preserveSingleLineBreaks?: boolean
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
  if (analysis.coverage.status === 'unsupported-domain') {
    return 'No result - outside calibrated domain'
  }
  if (analysis.coverage.status === 'below-reporting-threshold') {
    return 'Below reporting threshold'
  }
  if (analysis.classification === 'high') return 'High flagged coverage'
  if (analysis.classification === 'mixed') {
    return 'Some flagged coverage'
  }
  return 'No flagged coverage'
}

function auditTitle(sourceName: string): string {
  return `${cleanDocxText(sourceName)} - DraftLens writing-pattern audit`
}

function safeDocumentBaseName(sourceName: string): string {
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

  return safeBase || 'Untitled-draft'
}

export function getAuditReportFilename(sourceName: string): string {
  return `${safeDocumentBaseName(sourceName)}-DraftLens-audit.docx`
}

export function getCleanDocumentFilename(sourceName: string): string {
  return `${safeDocumentBaseName(sourceName)}-revised.docx`
}

export function getHighlightedEvidenceFilename(sourceName: string): string {
  return `${safeDocumentBaseName(sourceName)}-DraftLens-evidence.docx`
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

function summaryHeaderRow(): TableRow {
  return new TableRow({
    tableHeader: true,
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
            new TextRun({ text: 'Metric', bold: true, color: INK_BLUE }),
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
        shading: { type: ShadingType.CLEAR, fill: TABLE_FILL },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          tableParagraph([
            new TextRun({ text: 'Value', bold: true, color: INK_BLUE }),
          ]),
        ],
      }),
    ],
  })
}

function buildSummaryTable(analysis: AnalysisResult): Table {
  const sampleSufficiency = `${analysis.confidence.label} (${analysis.confidence.score}/100) - ${analysis.confidence.reason}`
  const isUnsupportedDomain =
    analysis.coverage.status === 'unsupported-domain'

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
      summaryHeaderRow(),
      summaryRow('Flagged prose coverage', analysis.coverage.displayLabel),
      summaryRow('Result', coverageResultLabel(analysis)),
      summaryRow('Sample sufficiency', sampleSufficiency),
      summaryRow(
        'Qualifying prose words',
        analysis.stats.qualifyingWordCount.toLocaleString('en-US'),
      ),
      summaryRow(
        'Words in flagged passages',
        isUnsupportedDomain
          ? 'Not reported outside calibrated domain'
          : analysis.stats.detectedWordCount.toLocaleString('en-US'),
      ),
      summaryRow(
        'Excluded non-prose words',
        analysis.stats.excludedWordCount.toLocaleString('en-US'),
      ),
      summaryRow('Pattern intensity', `${analysis.patternIntensity}/100`),
      summaryRow(
        'Flagged passages',
        isUnsupportedDomain
          ? 'None reported outside calibrated domain'
          : analysis.flaggedPassages.length.toLocaleString('en-US'),
      ),
      summaryRow('Calibration-domain check', analysis.domainSupport.label),
      summaryRow('Domain-check reason', analysis.domainSupport.reason),
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

function modelFactorParagraphs(factors: readonly ModelFactor[]): Paragraph[] {
  return factors.slice(0, 6).map((factor) => {
    const contribution = `${factor.contribution > 0 ? '+' : ''}${factor.contribution.toFixed(2)}`
    const direction =
      factor.direction === 'raises'
        ? 'raised'
        : factor.direction === 'lowers'
          ? 'lowered'
          : 'did not materially move'
    return new Paragraph({
      children: [
        new TextRun({ text: `${cleanDocxText(factor.label)}: `, bold: true }),
        new TextRun({
          text: contribution,
          bold: true,
          color: factor.direction === 'raises' ? ELEVATED_INK : HEADING_DARK_BLUE,
        }),
        new TextRun(
          ` ${direction} the model log-odds; observed value ${factor.value.toFixed(3)}.`,
        ),
      ],
    })
  })
}

function passageReviewChildren(
  passage: FlaggedPassage,
  index: number,
  sourcePage?: number,
): FileChild[] {
  const colors = bandColors(passage.classification)
  const pageLabel =
    sourcePage !== undefined && Number.isInteger(sourcePage) && sourcePage > 0
      ? ` - source page ${sourcePage}`
      : ''
  const children: FileChild[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun(
          `Passage ${index + 1} - ${passageBandLabel(passage.classification)}${pageLabel}`,
        ),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Word-weighted local estimate: ', bold: true }),
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

  if (passage.modelFactors && passage.modelFactors.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun('Causal model factors')],
      }),
      new Paragraph({
        style: 'AuditNote',
        children: [
          new TextRun(
            'These signed terms caused the statistical score. They explain model behavior, not authorship.',
          ),
        ],
      }),
      ...modelFactorParagraphs(passage.modelFactors),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun('Other observed writing patterns')],
      }),
    )
  }

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
  preserveSingleLineBreaks = false,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const paragraphBreak = preserveSingleLineBreaks
    ? /\r?\n+/gu
    : /\r?\n(?:[\t ]*\r?\n)+/gu
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
  const isUnsupportedDomain =
    analysis.coverage.status === 'unsupported-domain'
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
        new TextRun({
          text: isUnsupportedDomain
            ? 'No coverage result is reported. '
            : 'Interpret with care. ',
          bold: true,
        }),
        new TextRun(
          isUnsupportedDomain
            ? `This document falls outside the calibration corpus support bounds. DraftLens withholds the score and passage highlights instead of presenting an unsupported high-coverage result. ${analysis.domainSupport.reason}`
            : 'This is an independent writing-pattern estimate. It cannot determine authorship or prove that AI wrote any passage.',
        ),
      ],
    }),
    buildSummaryTable(analysis),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('What moved the estimate')],
    }),
    new Paragraph({
      style: 'AuditNote',
      children: [
        new TextRun(
          'Signed model terms below raised or lowered the calibrated estimate. They explain model behavior and do not establish authorship.',
        ),
      ],
    }),
    ...modelFactorParagraphs(analysis.modelFactors),
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
          'Both bands count equally toward flagged-prose coverage. They are review cues, not authorship findings.',
        ),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Flagged-passage review')],
    }),
    new Paragraph({
      style: 'AuditNote',
      children: [
        new TextRun(
          'Each passage separates signed statistical factors that caused the model score from other observable writing patterns used only as revision cues.',
        ),
      ],
    }),
  ]

  if (analysis.flaggedPassages.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun(
            isUnsupportedDomain
              ? 'No passage highlights are reported because the document is outside the calibrated domain.'
              : analysis.coverage.status === 'below-reporting-threshold'
                ? 'Passage highlights are withheld below 20% because isolated highlights carry a higher false-positive risk.'
                : 'No reportable passage highlights were produced for this result.',
          ),
        ],
      }),
    )
  } else {
    analysis.flaggedPassages.forEach((passage, index) => {
      children.push(
        ...passageReviewChildren(
          passage,
          index,
          input.passagePageReferences?.[passage.id],
        ),
      )
    })
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun('Audited document')],
    }),
    ...(isUnsupportedDomain
      ? [
          new Paragraph({
            style: 'AuditNote',
            children: [
              new TextRun({
                text: 'No score or passage highlighting is shown because the document is outside the calibrated domain.',
                bold: true,
              }),
            ],
          }),
        ]
      : [
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
        ]),
    ...highlightedSourceParagraphs(text, analysis.flaggedPassages),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
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

function buildHighlightedEvidenceChildren(
  input: AuditReportInput,
): FileChild[] {
  const { analysis, sourceName, text } = input
  const generatedAt = input.generatedAt ?? new Date()
  const isUnsupportedDomain =
    analysis.coverage.status === 'unsupported-domain'
  const children: FileChild[] = [
    new Paragraph({
      style: 'AuditKicker',
      children: [new TextRun('DRAFTLENS / HIGHLIGHTED EVIDENCE')],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun('Highlighted evidence document')],
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
        new TextRun({ text: 'Flagged prose coverage: ', bold: true }),
        new TextRun(analysis.coverage.displayLabel),
        new TextRun({ text: '    Reported passages: ', bold: true }),
        new TextRun(analysis.flaggedPassages.length.toLocaleString('en-US')),
      ],
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
      children: [
        new TextRun({
          text: isUnsupportedDomain
            ? 'No highlighting is reported. '
            : 'What the highlighting means. ',
          bold: true,
        }),
        new TextRun(
          isUnsupportedDomain
            ? `This document falls outside the calibration corpus support bounds, so an exact coverage score and passage highlights are withheld. ${analysis.domainSupport.reason}`
            : 'Highlighted passages crossed DraftLens\' local statistical threshold. They are evidence of a writing pattern, not proof of AI generation or authorship.',
        ),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Highlight key')],
    }),
    bandDefinitionParagraph('mixed'),
    bandDefinitionParagraph('high'),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Highlighted document')],
    }),
    ...highlightedSourceParagraphs(text, analysis.flaggedPassages),
  ]

  if (analysis.flaggedPassages.length === 0) {
    children.push(
      new Paragraph({
        style: 'AuditNote',
        children: [
          new TextRun(
            isUnsupportedDomain
              ? 'No passage highlights are reported because this document is outside the calibrated domain; the unhighlighted source is included for review.'
              : 'No reportable passage highlights were produced.',
          ),
        ],
      }),
    )
    return children
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun('Passage evidence notes')],
    }),
    new Paragraph({
      style: 'AuditNote',
      children: [
        new TextRun(
          'Each note separates signed statistical factors that caused the model score from other observable writing patterns used only as revision cues.',
        ),
      ],
    }),
  )
  analysis.flaggedPassages.forEach((passage, index) => {
    children.push(
      ...passageReviewChildren(
        passage,
        index,
        input.passagePageReferences?.[passage.id],
      ),
    )
  })

  return children
}

function createDocumentFooter(label: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: `${cleanDocxText(label)}  |  Page `,
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

interface StyledDocumentOptions {
  title: string
  subject: string
  description: string
  children: FileChild[]
  footerLabel?: string
}

function createStyledDocument(options: StyledDocumentOptions): Document {
  return new Document({
    creator: 'DraftLens',
    lastModifiedBy: 'DraftLens',
    title: options.title,
    subject: options.subject,
    description: options.description,
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
        ...(options.footerLabel
          ? {
              footers: {
                default: createDocumentFooter(options.footerLabel),
              },
            }
          : {}),
        children: options.children,
      },
    ],
  })
}

export function createAuditReportDocument(input: AuditReportInput): Document {
  const safeSourceName = cleanDocxText(input.sourceName)

  return createStyledDocument({
    title: auditTitle(safeSourceName),
    subject: 'Independent writing-pattern audit',
    description:
      'A local DraftLens writing-pattern estimate with passage-level evidence and limitations.',
    children: buildDocumentChildren({
      ...input,
      sourceName: safeSourceName,
    }),
    footerLabel: 'DraftLens audit',
  })
}

export function createCleanDocument(input: CleanDocumentInput): Document {
  const safeSourceName = cleanDocxText(input.sourceName)

  return createStyledDocument({
    title: safeSourceName,
    subject: 'Revised document',
    description: 'A clean document exported from the DraftLens revision workspace.',
    children: highlightedSourceParagraphs(
      input.text,
      [],
      input.preserveSingleLineBreaks,
    ),
  })
}

export function createHighlightedEvidenceDocument(
  input: AuditReportInput,
): Document {
  const safeSourceName = cleanDocxText(input.sourceName)

  return createStyledDocument({
    title: `${safeSourceName} - DraftLens highlighted evidence`,
    subject: 'Highlighted writing-pattern evidence',
    description:
      'A highlighted source document showing passages that crossed the local DraftLens statistical threshold.',
    children: buildHighlightedEvidenceChildren({
      ...input,
      sourceName: safeSourceName,
    }),
    footerLabel: 'DraftLens evidence',
  })
}

export async function buildAuditReportDocx(
  input: AuditReportInput,
): Promise<Blob> {
  return packDocument(createAuditReportDocument(input))
}

export async function buildCleanDocumentDocx(
  input: CleanDocumentInput,
): Promise<Blob> {
  return packDocument(createCleanDocument(input))
}

export async function buildHighlightedEvidenceDocx(
  input: AuditReportInput,
): Promise<Blob> {
  return packDocument(createHighlightedEvidenceDocument(input))
}

async function packDocument(document: Document): Promise<Blob> {
  const blob = await Packer.toBlob(document)
  return blob.type === DOCX_MIME
    ? blob
    : new Blob([blob], { type: DOCX_MIME })
}

async function downloadDocx(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 100)
}

export async function downloadAuditReportDocx(
  input: AuditReportInput,
): Promise<void> {
  await downloadDocx(
    await buildAuditReportDocx(input),
    getAuditReportFilename(input.sourceName),
  )
}

export async function downloadCleanDocumentDocx(
  input: CleanDocumentInput,
): Promise<void> {
  await downloadDocx(
    await buildCleanDocumentDocx(input),
    getCleanDocumentFilename(input.sourceName),
  )
}

export async function downloadHighlightedEvidenceDocx(
  input: AuditReportInput,
): Promise<void> {
  await downloadDocx(
    await buildHighlightedEvidenceDocx(input),
    getHighlightedEvidenceFilename(input.sourceName),
  )
}
