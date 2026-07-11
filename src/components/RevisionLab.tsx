import {
  Check,
  FilePenLine,
  ShieldAlert,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  compareRevisionAudits,
  type RevisionPreviewAnalysis,
} from '../lib/revision-preview'
import {
  composeRevisionDraft,
  type RevisionMode,
  type RevisionPlan,
  validateProtectedContent,
} from '../lib/revision'

interface RevisionLabProps {
  plan: RevisionPlan
  value: string
  currentAnalysis: RevisionPreviewAnalysis
  previewAnalysis: RevisionPreviewAnalysis | null
  mode: RevisionMode
  onChange: (value: string) => void
  onModeChange: (mode: RevisionMode) => void
  onPreview: () => void
  onApply: () => void
}

function passageLabel(passageId: string | null): string {
  if (passageId === null) return 'Full document'
  const number = passageId.match(/(\d+)$/u)?.[1]
  return number ? `Passage ${number}` : 'Detected passage'
}

function coverageLabel(analysis: RevisionPreviewAnalysis): string {
  if (analysis.coverage.status === 'insufficient-prose') return 'Not enough prose'
  if (analysis.coverage.status === 'out-of-range') return 'Outside range'
  return analysis.coverage.displayLabel
}

function auditMetricsMatch(
  current: RevisionPreviewAnalysis,
  preview: RevisionPreviewAnalysis,
): boolean {
  return (
    coverageLabel(current) === coverageLabel(preview) &&
    current.patternIntensity === preview.patternIntensity &&
    current.flaggedPassages.length === preview.flaggedPassages.length
  )
}

function changedTokenCount(before: string, after: string): number {
  const tokens = (value: string) =>
    value.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  const counts = new Map<string, number>()

  for (const token of tokens(before)) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  for (const token of tokens(after)) {
    counts.set(token, (counts.get(token) ?? 0) - 1)
  }

  return [...counts.values()].reduce((total, count) => total + Math.abs(count), 0)
}

export function RevisionLab({
  plan,
  value,
  currentAnalysis,
  previewAnalysis,
  mode,
  onChange,
  onModeChange,
  onPreview,
  onApply,
}: RevisionLabProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [acceptedEditIds, setAcceptedEditIds] = useState<Set<string>>(
    () => new Set(plan.edits.map((edit) => edit.id)),
  )
  const [protectedChangesAcknowledged, setProtectedChangesAcknowledged] =
    useState(false)
  const changed = value !== plan.sourceText
  const comparison = previewAnalysis
    ? compareRevisionAudits(currentAnalysis, previewAnalysis)
    : null
  const automaticDraftIsActive = value === plan.previewText
  const automaticChangedTokenCount = plan.edits.reduce(
    (total, edit) => total + changedTokenCount(edit.before, edit.after),
    0,
  )
  const hasOnlyMinorMechanicalEdits =
    plan.edits.length <= 3 && automaticChangedTokenCount <= 12
  const noSubstantiveAutomaticRevision = Boolean(
    previewAnalysis &&
      plan.edits.length > 0 &&
      automaticDraftIsActive &&
      hasOnlyMinorMechanicalEdits &&
      auditMetricsMatch(currentAnalysis, previewAnalysis),
  )
  const primaryLabel = !changed
    ? 'No changes to preview'
    : previewAnalysis
      ? 'Apply changes'
      : 'Preview changes'
  const protectedIssues = useMemo(
    () => validateProtectedContent(plan.sourceText, value),
    [plan.sourceText, value],
  )
  const canApplyProtectedChanges =
    protectedIssues.length === 0 || protectedChangesAcknowledged

  const rebuildFromSelection = (nextIds: Set<string>) => {
    setAcceptedEditIds(nextIds)
    setProtectedChangesAcknowledged(false)
    onChange(composeRevisionDraft(plan, nextIds))
  }

  const toggleEdit = (editId: string) => {
    const nextIds = new Set(acceptedEditIds)
    if (nextIds.has(editId)) nextIds.delete(editId)
    else nextIds.add(editId)
    rebuildFromSelection(nextIds)
  }

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [plan.sourceText])

  useEffect(() => {
    setAcceptedEditIds(new Set(plan.edits.map((edit) => edit.id)))
    setProtectedChangesAcknowledged(false)
  }, [plan.edits, plan.sourceText])

  useEffect(() => {
    setProtectedChangesAcknowledged(false)
  }, [protectedIssues])

  return (
    <div className="revision-lab">
      <div className="revision-lab__heading">
        <span className="revision-lab__icon">
          <Sparkles size={18} aria-hidden="true" />
        </span>
        <h3 ref={headingRef} tabIndex={-1}>Revision Lab</h3>
      </div>

      <fieldset className="revision-mode">
        <legend>Mechanical cleanup</legend>
        <div className="revision-mode__options">
          <label className={mode === 'conservative' ? 'is-selected' : ''}>
            <input
              aria-describedby="revision-mode-description"
              checked={mode === 'conservative'}
              name="revision-depth"
              onChange={() => onModeChange('conservative')}
              type="radio"
              value="conservative"
            />
            <span>Conservative</span>
          </label>
          <label className={mode === 'comprehensive' ? 'is-selected' : ''}>
            <input
              aria-describedby="revision-mode-description"
              checked={mode === 'comprehensive'}
              name="revision-depth"
              onChange={() => onModeChange('comprehensive')}
              type="radio"
              value="comprehensive"
            />
            <span>Document-wide</span>
          </label>
        </div>
        <p id="revision-mode-description">
          {mode === 'conservative'
            ? 'Mechanical cleanup in highlighted passages only.'
            : 'Document-wide mechanical cleanup of detected boilerplate and wordiness, not a contextual rewrite.'}
        </p>
      </fieldset>

      <p className="revision-safety" id="revision-safety-note">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>Review every change; keep facts and citations accurate.</span>
      </p>

      {plan.edits.length > 0 ? (
        <details className="revision-details">
          <summary>
            <Check size={15} aria-hidden="true" />
            Tracked edits
            <span>{acceptedEditIds.size}/{plan.edits.length}</span>
          </summary>
          <div className="revision-change-list">
            <div className="revision-change-list__actions">
              <button
                className="text-button"
                onClick={() =>
                  rebuildFromSelection(new Set(plan.edits.map((edit) => edit.id)))
                }
                type="button"
              >
                Accept all
              </button>
              <button
                className="text-button"
                onClick={() => rebuildFromSelection(new Set())}
                type="button"
              >
                Reject all
              </button>
            </div>
            {plan.edits.map((edit) => (
              <article aria-label={`Tracked edit for ${passageLabel(edit.passageId)}`} key={edit.id}>
                <div>
                  <label>
                    <input
                      checked={acceptedEditIds.has(edit.id)}
                      onChange={() => toggleEdit(edit.id)}
                      type="checkbox"
                    />
                    <strong>{passageLabel(edit.passageId)}</strong>
                  </label>
                  <span>{edit.rationale}</span>
                </div>
                <p><b>Before</b><del>{edit.before}</del></p>
                <p><b>Draft</b><ins>{edit.after}</ins></p>
              </article>
            ))}
          </div>
        </details>
      ) : (
        <p className="revision-no-safe-edits">
          <FilePenLine size={16} aria-hidden="true" />
          <span><strong>No automatic cleanup was available.</strong> Edit directly or use the writing prompts.</span>
        </p>
      )}

      <details className="revision-details revision-guidance">
        <summary>
          <FilePenLine size={15} aria-hidden="true" />
          Writing prompts
          <span>{plan.guidance.length}</span>
        </summary>
        <div className="revision-guidance-list">
          {plan.guidance.map((item) => (
            <article aria-label={`Writing prompt: ${item.title}`} key={item.signalId}>
              <strong>{item.title}</strong>
              <p>{item.instruction}</p>
            </article>
          ))}
        </div>
      </details>

      <label className="revision-editor-label" htmlFor="revision-document">
        Revised document
      </label>
      <textarea
        aria-describedby={`revision-safety-note${protectedIssues.length > 0 ? ' revision-protected-warning' : ''}`}
        className="revision-document-editor"
        id="revision-document"
        onChange={(event) => onChange(event.target.value)}
        spellCheck="true"
        value={value}
      />

      {protectedIssues.length > 0 && (
        <div aria-live="polite" className="revision-protected-warning" id="revision-protected-warning" role="status">
          <ShieldAlert size={17} aria-hidden="true" />
          <div>
            <strong>Review protected-content changes</strong>
            <p>
              {protectedIssues.length} change{protectedIssues.length === 1 ? '' : 's'}
              {' '}affect numbers, citations, quotations, names, or qualifiers.
            </p>
            <ul>
              {protectedIssues.slice(0, 5).map((issue, index) => (
                <li key={`${issue.kind}-${issue.change}-${issue.value}-${index}`}>
                  {issue.change === 'added' ? 'Added' : 'Removed'} <q>{issue.value}</q>
                </li>
              ))}
            </ul>
            <label>
              <input
                checked={protectedChangesAcknowledged}
                onChange={(event) =>
                  setProtectedChangesAcknowledged(event.target.checked)
                }
                type="checkbox"
              />
              I reviewed these changes against the source.
            </label>
          </div>
        </div>
      )}

      <section
        aria-labelledby="revision-preview-title"
        aria-live="polite"
        className="revision-audit-preview"
      >
        <h4 id="revision-preview-title">Audit preview</h4>

        {previewAnalysis && comparison ? (
          <>
            <table className="revision-comparison">
              <caption className="visually-hidden">Current and draft audit comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Current</th>
                  <th scope="col">Draft</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Flagged prose coverage</th>
                  <td>{coverageLabel(currentAnalysis)}</td>
                  <td>{coverageLabel(previewAnalysis)}</td>
                </tr>
                <tr>
                  <th scope="row">Pattern intensity</th>
                  <td>{currentAnalysis.patternIntensity}</td>
                  <td>{previewAnalysis.patternIntensity}</td>
                </tr>
                <tr>
                  <th scope="row">Flagged passages</th>
                  <td>{currentAnalysis.flaggedPassages.length}</td>
                  <td>{previewAnalysis.flaggedPassages.length}</td>
                </tr>
              </tbody>
            </table>
            <p className={`revision-preview-outcome revision-preview-outcome--${comparison.direction}`}>
              {noSubstantiveAutomaticRevision ? (
                <><strong>Only minor mechanical cleanup was available.</strong> The audit metrics are unchanged.</>
              ) : (
                <strong>{comparison.headline}</strong>
              )}
            </p>
          </>
        ) : (
          <p className="revision-preview-empty">
            {changed
              ? 'Preview this draft before applying it.'
              : 'Edit the document to preview changes.'}
          </p>
        )}
      </section>

      <div className="revision-lab__actions">
        <button
          className="quiet-button"
          disabled={!changed}
          onClick={() => rebuildFromSelection(new Set())}
          type="button"
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset draft
        </button>
        <button
          aria-describedby={protectedIssues.length > 0 ? 'revision-protected-warning' : undefined}
          className="primary-button"
          disabled={!changed || !canApplyProtectedChanges}
          onClick={previewAnalysis ? onApply : onPreview}
          type="button"
        >
          <FilePenLine size={16} aria-hidden="true" />
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}
