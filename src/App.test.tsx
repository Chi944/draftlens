import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { ExtractedDocument } from './lib/document'
import type { AnalysisResult } from './lib/types'

type AnalysisOptions = {
  signal?: AbortSignal
  onProgress?: (phase: 'preparing' | 'analyzing' | 'finalizing') => void
}

const mocks = vi.hoisted(() => ({
  analyzeTextAsync: vi.fn(),
  getContextualRevisionAvailability: vi.fn(),
  requestContextualRevision: vi.fn(),
  extractTextFromFile: vi.fn(),
}))

vi.mock('./lib/analysis-client', () => ({
  analyzeTextAsync: mocks.analyzeTextAsync,
}))

vi.mock('./lib/contextual-revision', () => ({
  getContextualRevisionAvailability:
    mocks.getContextualRevisionAvailability,
  requestContextualRevision: mocks.requestContextualRevision,
}))

vi.mock('./lib/document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/document')>()
  return { ...actual, extractTextFromFile: mocks.extractTextFromFile }
})

const firstPassage =
  'Moreover, it is important to note that this framework facilitates meaningful outcomes.'
const secondPassage =
  'Furthermore, the implementation of this approach underscores important progress.'
const draftText = `${firstPassage} ${secondPassage}`
const secondPassageStart = firstPassage.length + 1

const raisingFactor = {
  source: 'calibrated-model' as const,
  feature: 'mean_sentence_length',
  label: 'Mean sentence length',
  value: 21.5,
  standardizedValue: 1.1,
  contribution: 1.25,
  direction: 'raises' as const,
}

const loweringFactor = {
  source: 'calibrated-model' as const,
  feature: 'type_token_ratio',
  label: 'Vocabulary variety',
  value: 0.72,
  standardizedValue: -0.4,
  contribution: -0.35,
  direction: 'lowers' as const,
}

const analysisResult: AnalysisResult = {
  score: 78,
  coverage: {
    rawPercent: 78,
    displayedPercent: 78,
    displayLabel: '78%',
    status: 'exact',
    qualifyingWordCount: 24,
    detectedWordCount: 19,
    excludedWordCount: 0,
    qualifyingSentenceCount: 2,
    detectedSentenceCount: 2,
  },
  patternIntensity: 67,
  modelFactors: [raisingFactor, loweringFactor],
  writingCharacteristics: [
    {
      source: 'writing-characteristic',
      id: 'sentence-length',
      label: 'Average sentence length',
      value: 12,
      displayValue: '12 words',
      description: 'Average words per sentence.',
    },
  ],
  domainSupport: {
    status: 'supported',
    label: 'Supported prose',
    reason: 'The document is within the calibrated long-form prose domain.',
    lexicalContributionShare: 0.18,
  },
  classification: 'high',
  confidence: {
    level: 'medium',
    score: 72,
    label: 'Usable sample',
    reason: 'Enough continuous prose is available for passage review.',
  },
  summary:
    'Flagged coverage comes from two passages that crossed the calibrated threshold.',
  sentences: [
    {
      id: 'sentence-1',
      index: 0,
      text: firstPassage,
      start: 0,
      end: firstPassage.length,
      wordCount: 13,
      qualifies: true,
      likelihood: 0.91,
      detected: true,
      patternScore: 81,
      score: 91,
      classification: 'high',
      signals: [
        {
          id: 'stock-phrases',
          label: 'Stock framing',
          description: 'The sentence uses a repeated framing phrase.',
          impact: 12,
          evidence: ['it is important to note that'],
        },
      ],
      modelFactors: [raisingFactor, loweringFactor],
    },
    {
      id: 'sentence-2',
      index: 1,
      text: secondPassage,
      start: secondPassageStart,
      end: draftText.length,
      wordCount: 11,
      qualifies: true,
      likelihood: 0.79,
      detected: true,
      patternScore: 70,
      score: 79,
      classification: 'mixed',
      signals: [
        {
          id: 'nominalized-language',
          label: 'Nominalized language',
          description: 'The sentence relies on abstract noun phrases.',
          impact: 8,
          evidence: ['the implementation of'],
        },
      ],
      modelFactors: [raisingFactor, loweringFactor],
    },
  ],
  flaggedPassages: [
    {
      id: 'passage-1',
      start: 0,
      end: firstPassage.length,
      text: firstPassage,
      score: 91,
      classification: 'high',
      sentenceIds: ['sentence-1'],
      signals: [
        {
          id: 'stock-phrases',
          label: 'Stock framing',
          description: 'The passage uses a repeated framing phrase.',
          affectedSentenceCount: 1,
          occurrenceCount: 1,
          totalImpact: 12,
          evidence: ['it is important to note that'],
        },
      ],
      modelFactors: [raisingFactor, loweringFactor],
    },
    {
      id: 'passage-2',
      start: secondPassageStart,
      end: draftText.length,
      text: secondPassage,
      score: 79,
      classification: 'mixed',
      sentenceIds: ['sentence-2'],
      signals: [
        {
          id: 'nominalized-language',
          label: 'Nominalized language',
          description: 'The passage relies on an abstract noun phrase.',
          affectedSentenceCount: 1,
          occurrenceCount: 1,
          totalImpact: 8,
          evidence: ['the implementation of'],
        },
      ],
      modelFactors: [raisingFactor, loweringFactor],
    },
  ],
  topSignals: [
    {
      id: 'stock-phrases',
      label: 'Stock framing',
      description: 'Repeated framing language.',
      affectedSentenceCount: 1,
      occurrenceCount: 1,
      totalImpact: 12,
      evidence: ['it is important to note that'],
    },
  ],
  stats: {
    characterCount: draftText.length,
    wordCount: 24,
    qualifyingWordCount: 24,
    excludedWordCount: 0,
    detectedWordCount: 19,
    sentenceCount: 2,
    qualifyingSentenceCount: 2,
    detectedSentenceCount: 2,
    paragraphCount: 1,
    averageSentenceLength: 12,
    sentenceLengthVariation: 8,
    flaggedSentenceCount: 2,
    flaggedPassageCount: 2,
    uniqueWordRatio: 79,
  },
  coaching: [
    {
      id: 'coaching-1',
      priority: 'high',
      title: 'State the claim directly',
      rationale: 'Direct wording makes the reasoning easier to inspect.',
      action: 'Remove the framing phrase and retain the underlying claim.',
      relatedSignalIds: ['stock-phrases'],
    },
    {
      id: 'coaching-2',
      priority: 'medium',
      title: 'Use a concrete verb',
      rationale: 'A concrete verb can clarify the actor and action.',
      action: 'Replace the abstract noun phrase with a precise verb.',
      relatedSignalIds: ['nominalized-language'],
    },
  ],
  methodology: {
    name: 'DraftLens calibrated estimator',
    version: 'test',
    kind: 'calibrated-writing-pattern-estimator',
    description: 'Overlapping prose windows are evaluated locally.',
    scoreMeaning: 'The score reports flagged qualifying-prose coverage.',
    thresholds: {
      low: 'Below the local review threshold.',
      mixed: 'Crosses the review threshold.',
      high: 'Crosses the elevated threshold.',
    },
    heuristics: ['Long-form prose only'],
    profileId: 'test-profile',
  },
  limitations: [
    'Writing-pattern evidence cannot establish who or what authored text.',
  ],
}

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  mocks.analyzeTextAsync.mockImplementation(
    async (_text: string, options?: AnalysisOptions) => {
      options?.onProgress?.('analyzing')
      await Promise.resolve()
      options?.onProgress?.('finalizing')
      return analysisResult
    },
  )
  mocks.getContextualRevisionAvailability.mockResolvedValue(false)
})

afterEach(cleanup)

function renderPasteEditor(): void {
  render(<App />)
  fireEvent.click(screen.getByRole('tab', { name: 'Paste text' }))
  fireEvent.change(screen.getByLabelText('Paste your writing'), {
    target: { value: draftText },
  })
}

async function analyzeToSummary(): Promise<void> {
  renderPasteEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Analyse writing' }))
  await screen.findByRole('navigation', { name: 'Review steps' })
}

function reviewStep(name: 'Summary' | 'Evidence' | 'Revise'): HTMLElement {
  return within(
    screen.getByRole('navigation', { name: 'Review steps' }),
  ).getByRole('button', { name: new RegExp(name, 'u') })
}

describe('document entry', () => {
  it('switches cleanly between Upload and Paste without showing both inputs', () => {
    render(<App />)

    const uploadTab = screen.getByRole('tab', { name: 'Upload' })
    const pasteTab = screen.getByRole('tab', { name: 'Paste text' })
    expect(uploadTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Drop a file or choose one')).toBeInTheDocument()
    expect(screen.queryByLabelText('Paste your writing')).not.toBeInTheDocument()

    fireEvent.click(pasteTab)
    expect(pasteTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Paste your writing')).toBeInTheDocument()
    expect(screen.queryByText('Drop a file or choose one')).not.toBeInTheDocument()

    fireEvent.click(uploadTab)
    expect(screen.getByText('Drop a file or choose one')).toBeInTheDocument()
    expect(screen.queryByLabelText('Paste your writing')).not.toBeInTheDocument()
  })

  it('runs analysis asynchronously and exposes progress before showing Summary', async () => {
    let resolveAnalysis: (result: AnalysisResult) => void = () => undefined
    const pendingAnalysis = new Promise<AnalysisResult>((resolve) => {
      resolveAnalysis = resolve
    })
    mocks.analyzeTextAsync.mockImplementationOnce(
      (_text: string, options?: AnalysisOptions) => {
        options?.onProgress?.('analyzing')
        return pendingAnalysis
      },
    )
    renderPasteEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Analyse writing' }))

    expect(mocks.analyzeTextAsync).toHaveBeenCalledWith(
      draftText,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function),
      }),
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getAllByText(/analyzing/i).length).toBeGreaterThan(0)

    await act(async () => {
      resolveAnalysis(analysisResult)
      await pendingAnalysis
    })

    expect(
      await screen.findByRole('navigation', { name: 'Review steps' }),
    ).toBeInTheDocument()
    expect(reviewStep('Summary')).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

describe('review workflow', () => {
  it('explains the score with signed model evidence and disclaims authorship proof', async () => {
    await analyzeToSummary()

    expect(
      screen.getByRole('img', { name: 'Flagged prose coverage: 78%' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Causal model evidence')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'What moved the estimate' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Signed terms from the calibrated model.')).toBeInTheDocument()
    expect(screen.getByText('Mean sentence length')).toBeInTheDocument()
    expect(screen.getByText('+1.25')).toBeInTheDocument()
    expect(
      screen.getByText(/It is not the probability that AI wrote the document/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/AI-generated content detected/i)).not.toBeInTheDocument()
  })

  it('withholds saturated out-of-domain results instead of showing a high percentage', async () => {
    const unsupportedResult: AnalysisResult = {
      ...analysisResult,
      coverage: {
        ...analysisResult.coverage,
        displayedPercent: null,
        displayLabel: 'Outside calibrated domain',
        status: 'unsupported-domain',
      },
      domainSupport: {
        status: 'unsupported',
        label: 'Outside calibrated domain',
        reason:
          'Formal vocabulary and lexical model pressure exceed the calibration support bounds.',
        lexicalContributionShare: 0.91,
      },
      flaggedPassages: [],
    }
    mocks.analyzeTextAsync.mockResolvedValueOnce(unsupportedResult)

    renderPasteEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Analyse writing' }))
    await screen.findByRole('navigation', { name: 'Review steps' })

    expect(
      screen.getByRole('img', {
        name: 'Flagged prose coverage: Outside calibrated domain',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Outside calibrated domain')).not.toHaveLength(0)
    expect(screen.getByText('Percentage withheld')).toBeInTheDocument()
    expect(screen.queryByText('High flagged coverage')).not.toBeInTheDocument()
    expect(screen.queryByText(/19 flagged ÷ 24 qualifying words/i)).not.toBeInTheDocument()
  })

  it('moves through the Summary, Evidence, and Revise steps', async () => {
    await analyzeToSummary()

    expect(reviewStep('Summary')).toHaveAttribute('aria-current', 'step')
    fireEvent.click(reviewStep('Evidence'))
    expect(
      screen.getByRole('heading', { name: 'Inspect in context' }),
    ).toBeInTheDocument()
    expect(reviewStep('Evidence')).toHaveAttribute('aria-current', 'step')

    fireEvent.click(reviewStep('Revise'))
    expect(
      screen.getByRole('heading', { name: 'Review every change' }),
    ).toBeInTheDocument()
    expect(reviewStep('Revise')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Nothing is applied until you approve it.')).toBeInTheDocument()
  })

  it('restores the page when revision is opened from the mobile evidence drawer', async () => {
    await analyzeToSummary()
    fireEvent.click(reviewStep('Evidence'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Evidence details' }),
    )

    const dialog = screen.getByRole('dialog', {
      name: 'What moved this passage',
    })
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.querySelector('.site-header')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Revise this document' }),
    )

    expect(
      await screen.findByRole('heading', { name: 'Review every change' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(document.querySelector('.site-header')).not.toHaveAttribute(
      'aria-hidden',
    )
  })

  it('tracks review state while moving through the passage queue', async () => {
    await analyzeToSummary()
    fireEvent.click(reviewStep('Evidence'))

    const queue = screen.getByLabelText('Passage queue')
    expect(within(queue).getByText('Passage 1 of 2')).toBeInTheDocument()
    expect(within(queue).getByText('0 reviewed')).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Previous passage' })).toBeDisabled()

    fireEvent.click(within(queue).getByRole('button', { name: 'Mark reviewed' }))
    expect(within(queue).getByRole('button', { name: 'Reviewed' })).toBeInTheDocument()
    expect(within(queue).getByText('1 reviewed')).toBeInTheDocument()

    fireEvent.click(within(queue).getByRole('button', { name: 'Next passage' }))
    expect(within(queue).getByText('Passage 2 of 2')).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Next passage' })).toBeDisabled()
    expect(within(queue).getByRole('button', { name: 'Previous passage' })).toBeEnabled()

    fireEvent.click(within(queue).getByRole('button', { name: 'Mark reviewed' }))
    expect(within(queue).getByText('2 reviewed')).toBeInTheDocument()
  })

  it('keeps contextual editing opt-in and disabled when no provider is configured', async () => {
    await analyzeToSummary()
    fireEvent.click(reviewStep('Revise'))

    const contextualSummary = screen
      .getByText('Optional contextual edit')
      .closest('summary')
    expect(contextualSummary).not.toBeNull()
    fireEvent.click(contextualSummary!)

    const optIn = screen.getByRole('checkbox', {
      name: /Allow this passage to be sent for editing/i,
    })
    expect(optIn).not.toBeChecked()
    fireEvent.click(optIn)

    expect(
      await screen.findByText(/Optional provider is not configured/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate suggestion' }),
    ).toBeDisabled()
    expect(
      screen.getByText(/Only passage 1 is relayed through Vercel/i),
    ).toBeInTheDocument()
    expect(mocks.getContextualRevisionAvailability).toHaveBeenCalledOnce()
    expect(mocks.requestContextualRevision).not.toHaveBeenCalled()
  })

  it('invalidates edited page offsets and restores them when the revision is undone', async () => {
    const extracted: ExtractedDocument = {
      text: draftText,
      name: 'paged-report.pdf',
      kind: 'pdf',
      pageCount: 2,
      source: {
        name: 'paged-report.pdf',
        kind: 'pdf',
        sizeBytes: 100,
        mimeType: 'application/pdf',
        lastModified: 0,
      },
      pageSpans: [
        {
          pageNumber: 1,
          start: 0,
          end: firstPassage.length,
          textSource: 'embedded-text',
          detection: 'readable-text',
        },
        {
          pageNumber: 2,
          start: secondPassageStart,
          end: draftText.length,
          textSource: 'embedded-text',
          detection: 'readable-text',
        },
      ],
      receipt: {
        importedAt: '2026-07-11T00:00:00.000Z',
        method: 'pdf-text',
        characterCount: draftText.length,
        pageCount: 2,
        sparsePdfPages: [],
        ocrPages: [],
        warnings: [],
      },
    }
    mocks.extractTextFromFile.mockResolvedValueOnce(extracted)
    const { container } = render(<App />)
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput!, {
      target: { files: [new File(['pdf'], 'paged-report.pdf', { type: 'application/pdf' })] },
    })
    await screen.findByText('PDF text · 100 B · 2 pages')

    fireEvent.click(screen.getByRole('button', { name: 'Analyse writing' }))
    await screen.findByRole('navigation', { name: 'Review steps' })
    fireEvent.click(reviewStep('Evidence'))
    expect(within(screen.getByLabelText('Passage queue')).getByText(/Page 1/)).toBeInTheDocument()

    fireEvent.click(reviewStep('Revise'))
    const editor = await screen.findByRole('textbox', { name: 'Revised document' })
    fireEvent.change(editor, { target: { value: `${draftText} Clear prose.` } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    const apply = await screen.findByRole('button', { name: 'Apply changes' })
    fireEvent.click(apply)

    fireEvent.click(reviewStep('Evidence'))
    expect(within(screen.getByLabelText('Passage queue')).queryByText(/Page 1/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByText('Last applied revision undone.')
    fireEvent.click(reviewStep('Evidence'))
    expect(within(screen.getByLabelText('Passage queue')).getByText(/Page 1/)).toBeInTheDocument()
  })
})
