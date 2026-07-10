import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RevisionPlan } from '../lib/revision'
import { RevisionLab } from './RevisionLab'

afterEach(cleanup)

const plan: RevisionPlan = {
  status: 'ready',
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

describe('RevisionLab', () => {
  it('shows an editable starter draft and applies reviewed changes', () => {
    const onChange = vi.fn()
    const onApply = vi.fn()

    render(
      <RevisionLab
        baselineText={plan.sourceText}
        onApply={onApply}
        onChange={onChange}
        plan={plan}
        value={plan.previewText}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Revision Lab' })).toHaveFocus()
    expect(screen.getByLabelText('Editable revised document')).toHaveValue(
      plan.previewText,
    )
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Editable revised document'), {
      target: { value: 'The trial ended on Tuesday.' },
    })
    expect(onChange).toHaveBeenCalledWith('The trial ended on Tuesday.')

    fireEvent.click(screen.getByRole('button', { name: 'Apply and re-audit' }))
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('disables apply when the draft matches the current document', () => {
    render(
      <RevisionLab
        baselineText={plan.sourceText}
        onApply={vi.fn()}
        onChange={vi.fn()}
        plan={plan}
        value={plan.sourceText}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Apply and re-audit' }),
    ).toBeDisabled()
  })

  it('shows guidance instead of fabricating a rewrite', () => {
    const guidanceOnly: RevisionPlan = {
      ...plan,
      status: 'no-safe-edits',
      previewText: plan.sourceText,
      edits: [],
    }

    render(
      <RevisionLab
        baselineText={plan.sourceText}
        onApply={vi.fn()}
        onChange={vi.fn()}
        plan={guidanceOnly}
        value={guidanceOnly.previewText}
      />,
    )

    expect(
      screen.getByText('No wording was changed automatically.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Audit-guided prompts')).toBeInTheDocument()
  })
})
