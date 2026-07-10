import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RevisionPreviewAnalysis } from '../lib/revision-preview'
import type { RevisionPlan } from '../lib/revision'
import { RevisionLab } from './RevisionLab'

afterEach(cleanup)

const plan: RevisionPlan = {
  status: 'ready',
  mode: 'comprehensive',
  sourceText: 'It is clear that the trial ended.',
  previewText: 'Clearly, the trial ended.',
  passageCount: 1,
  edits: [
    {
      id: 'revision-sentence-1',
      passageId: 'passage-1',
      sentenceId: 'sentence-1',
      ruleIds: ['compress-clear-frame'],
      start: 0,
      end: 34,
      before: 'It is clear that the trial ended.',
      after: 'Clearly, the trial ended.',
      rationale: 'Compressed framing.',
    },
  ],
  guidance: [
    {
      signalId: 'low-specificity',
      title: 'Add only details you can verify',
      instruction: 'Use verified notes and sources.',
    },
  ],
  warnings: ['Review every change before applying it.'],
}

function analysis(
  score = 80,
  patternIntensity = 70,
): RevisionPreviewAnalysis {
  return {
    score,
    patternIntensity,
    coverage: {
      rawPercent: score,
      displayedPercent: score,
      displayLabel: `${score}%`,
      status: 'exact',
      qualifyingWordCount: 400,
      detectedWordCount: 320,
      excludedWordCount: 0,
      qualifyingSentenceCount: 20,
      detectedSentenceCount: 12,
    },
    flaggedPassages: [],
    stats: {
      characterCount: 2_000,
      wordCount: 400,
      qualifyingWordCount: 400,
      excludedWordCount: 0,
      detectedWordCount: 320,
      sentenceCount: 20,
      qualifyingSentenceCount: 20,
      detectedSentenceCount: 12,
      paragraphCount: 5,
      averageSentenceLength: 20,
      sentenceLengthVariation: 30,
      flaggedSentenceCount: 12,
      flaggedPassageCount: 2,
      uniqueWordRatio: 65,
    },
  }
}

function renderLab(
  overrides: Partial<ComponentProps<typeof RevisionLab>> = {},
) {
  const props: ComponentProps<typeof RevisionLab> = {
    baselineText: plan.sourceText,
    currentAnalysis: analysis(),
    mode: 'comprehensive',
    onApply: vi.fn(),
    onChange: vi.fn(),
    onModeChange: vi.fn(),
    onPreview: vi.fn(),
    plan,
    previewAnalysis: analysis(80, 48),
    value: plan.previewText,
    ...overrides,
  }
  render(<RevisionLab {...props} />)
  return props
}

describe('RevisionLab', () => {
  it('shows an editable comprehensive draft and applies the previewed text', () => {
    const props = renderLab()

    expect(screen.getByRole('heading', { name: 'Revision Lab' })).toHaveFocus()
    expect(screen.getByLabelText('Editable revised document')).toHaveValue(
      plan.previewText,
    )
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Local coverage is unchanged.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Editable revised document'), {
      target: { value: 'The trial ended on Tuesday.' },
    })
    expect(props.onChange).toHaveBeenCalledWith('The trial ended on Tuesday.')

    fireEvent.click(screen.getByRole('button', { name: 'Apply previewed draft' }))
    expect(props.onApply).toHaveBeenCalledOnce()
  })

  it('requires a current preview before the draft can be applied', () => {
    const props = renderLab({ previewAnalysis: null })

    expect(screen.getByText('Preview needed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Apply previewed draft' }),
    ).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Preview draft audit' }))
    expect(props.onPreview).toHaveBeenCalledOnce()
  })

  it('disables apply when the draft matches the current document', () => {
    renderLab({ value: plan.sourceText })

    expect(
      screen.getByRole('button', { name: 'Apply previewed draft' }),
    ).toBeDisabled()
  })

  it('switches revision depth with native radio controls', () => {
    const props = renderLab()
    const conservative = screen.getByRole('radio', {
      name: 'Conservative cleanup Only compresses high-confidence boilerplate in highlighted passages.',
    })

    expect(
      screen.getByRole('radio', {
        name: 'Comprehensive clarity Also scans all qualifying prose for safe redundancy and wordiness.',
      }),
    ).toBeChecked()
    fireEvent.click(conservative)
    expect(props.onModeChange).toHaveBeenCalledWith('conservative')
  })

  it('shows guidance instead of fabricating a rewrite', () => {
    const guidanceOnly: RevisionPlan = {
      ...plan,
      status: 'no-safe-edits',
      previewText: plan.sourceText,
      edits: [],
    }

    renderLab({
      plan: guidanceOnly,
      previewAnalysis: analysis(),
      value: guidanceOnly.previewText,
    })

    expect(
      screen.getByText('No wording was changed automatically.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Evidence-dependent revision prompts'),
    ).toBeInTheDocument()
  })
})
