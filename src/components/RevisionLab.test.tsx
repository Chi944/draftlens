import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
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
  it('shows a compact editable draft and applies a current preview', () => {
    const props = renderLab()

    expect(screen.getByRole('heading', { name: 'Revision Lab' })).toHaveFocus()
    expect(screen.getByLabelText('Revised document')).toHaveValue(
      plan.previewText,
    )
    expect(screen.getByText('Tracked edits').closest('details')).not.toHaveAttribute(
      'open',
    )
    expect(screen.getByText('Writing prompts').closest('details')).not.toHaveAttribute(
      'open',
    )

    const table = screen.getByRole('table', {
      name: 'Current and draft audit comparison',
    })
    expect(within(table).getByText('Flagged prose coverage')).toBeInTheDocument()
    expect(within(table).getByText('Pattern intensity')).toBeInTheDocument()
    expect(within(table).getByText('Flagged passages')).toBeInTheDocument()
    expect(within(table).queryByText('Qualifying words')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Revised document'), {
      target: { value: 'The trial ended on Tuesday.' },
    })
    expect(props.onChange).toHaveBeenCalledWith('The trial ended on Tuesday.')

    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(props.onApply).toHaveBeenCalledOnce()
  })

  it('uses the primary action to preview stale draft text', () => {
    const props = renderLab({ previewAnalysis: null })

    expect(screen.getByText('Preview this draft before applying it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    expect(props.onPreview).toHaveBeenCalledOnce()
    expect(props.onApply).not.toHaveBeenCalled()
  })

  it('disables preview and reset when the draft matches the current document', () => {
    renderLab({ previewAnalysis: null, value: plan.sourceText })

    expect(
      screen.getByRole('button', { name: 'No changes to preview' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset draft' })).toBeDisabled()
  })

  it('switches cleanup scope with compact native radio controls', () => {
    const props = renderLab()
    const conservative = screen.getByRole('radio', { name: 'Conservative' })

    expect(screen.getByRole('radio', { name: 'Document-wide' })).toBeChecked()
    expect(
      screen.getByText(/Document-wide mechanical cleanup.+not a contextual rewrite/u),
    ).toBeInTheDocument()

    fireEvent.click(conservative)
    expect(props.onModeChange).toHaveBeenCalledWith('conservative')
  })

  it('shows prompts instead of claiming a rewrite when no safe edits exist', () => {
    const guidanceOnly: RevisionPlan = {
      ...plan,
      status: 'no-safe-edits',
      previewText: plan.sourceText,
      edits: [],
    }

    renderLab({
      plan: guidanceOnly,
      previewAnalysis: null,
      value: guidanceOnly.previewText,
    })

    expect(screen.getByText('No automatic cleanup was available.')).toBeInTheDocument()
    expect(screen.getByText('Writing prompts')).toBeInTheDocument()
  })

  it('calls unchanged mechanical edits out when their audit metrics do not move', () => {
    renderLab({ previewAnalysis: analysis() })

    expect(
      screen.getByText('Only minor mechanical cleanup was available.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The audit metrics are unchanged.'),
    ).toBeInTheDocument()
  })

  it('does not call a broader clarity pass trivial solely because metrics are unchanged', () => {
    const broaderPlan: RevisionPlan = {
      ...plan,
      edits: Array.from({ length: 4 }, (_, index) => ({
        ...plan.edits[0],
        id: `revision-sentence-${index + 1}`,
        sentenceId: `sentence-${index + 1}`,
      })),
    }

    renderLab({ plan: broaderPlan, previewAnalysis: analysis() })

    expect(
      screen.queryByText('Only minor mechanical cleanup was available.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Local coverage is unchanged.')).toBeInTheDocument()
  })

  it('resets the working draft to the current audited wording', () => {
    const props = renderLab()

    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }))
    expect(props.onChange).toHaveBeenCalledWith(plan.sourceText)
  })

  it('accepts and rejects generated edits individually', () => {
    const props = renderLab()
    fireEvent.click(screen.getByText('Tracked edits'))

    const editToggle = screen.getByRole('checkbox', { name: 'Passage 1' })
    expect(editToggle).toBeChecked()
    fireEvent.click(editToggle)
    expect(props.onChange).toHaveBeenCalledWith(plan.sourceText)

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(props.onChange).toHaveBeenCalledWith(plan.previewText)
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }))
    expect(props.onChange).toHaveBeenLastCalledWith(plan.sourceText)
  })

  it('requires acknowledgement when protected facts change', () => {
    const protectedPlan: RevisionPlan = {
      ...plan,
      sourceText: 'The clinic reviewed 48 records.',
      previewText: 'The clinic reviewed 48 records carefully.',
      edits: [],
    }
    renderLab({
      plan: protectedPlan,
      value: 'The clinic reviewed 49 records.',
      previewAnalysis: analysis(),
    })

    expect(screen.getByText('Review protected-content changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed these changes against the source.',
      }),
    )
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeEnabled()
  })
})
