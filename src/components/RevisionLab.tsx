import {
  ArrowRight,
  BarChart3,
  Check,
  FilePenLine,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import {
  compareRevisionAudits,
  type RevisionPreviewAnalysis,
} from '../lib/revision-preview'
import type {
  RevisionMode,
  RevisionPlan,
} from '../lib/revision'

interface RevisionLabProps {
  plan: RevisionPlan
  value: string
  baselineText: string | null
  currentAnalysis: RevisionPreviewAnalysis
  previewAnalysis: RevisionPreviewAnalysis | null
  mode: RevisionMode
  onChange: (value: string) => void
  onModeChange: (mode: RevisionMode) => void
  onPreview: () => void
  onApply: () => void
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
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

export function RevisionLab({
  plan,
  value,
  baselineText,
  currentAnalysis,
  previewAnalysis,
  mode,
  onChange,
  onModeChange,
  onPreview,
  onApply,
}: RevisionLabProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const changed = value !== plan.sourceText
  const canLoadBaseline =
    baselineText !== null && baselineText !== plan.sourceText
  const comparison = previewAnalysis
    ? compareRevisionAudits(currentAnalysis, previewAnalysis)
    : null

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [plan.sourceText])

  return (
    <div className="revision-lab">
      <div className="revision-lab__heading">
        <span className="revision-lab__icon">
          <Sparkles size={18} aria-hidden="true" />
        </span>
        <div>
          <span className="section-kicker">Local editing workspace</span>
          <h3 ref={headingRef} tabIndex={-1}>Revision Lab</h3>
          <p>
            Build a reviewable clarity draft, edit it in your own voice, preview
            the local audit, and apply only the exact version you approved.
          </p>
        </div>
      </div>

      <div className="revision-safety" id="revision-safety-note">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>{plan.warnings[0]}</p>
      </div>

      <fieldset className="revision-mode">
        <legend>Revision depth</legend>
        <div className="revision-mode__options">
          <label className={mode === 'conservative' ? 'is-selected' : ''}>
            <input
              checked={mode === 'conservative'}
              name="revision-depth"
              onChange={() => onModeChange('conservative')}
              type="radio"
              value="conservative"
            />
            <span>
              <strong>Conservative cleanup</strong>
              <small>Only compresses high-confidence boilerplate in highlighted passages.</small>
            </span>
          </label>
          <label className={mode === 'comprehensive' ? 'is-selected' : ''}>
            <input
              checked={mode === 'comprehensive'}
              name="revision-depth"
              onChange={() => onModeChange('comprehensive')}
              type="radio"
              value="comprehensive"
            />
            <span>
              <strong>Comprehensive clarity</strong>
              <small>Also scans all qualifying prose for safe redundancy and wordiness.</small>
            </span>
          </label>
        </div>
        <p>Changing depth rebuilds the uncommitted starter draft.</p>
      </fieldset>

      <dl className="revision-stats" aria-label="Revision draft statistics">
        <div>
          <dt>Reportable passages</dt>
          <dd>{plan.passageCount}</dd>
        </div>
        <div>
          <dt>Suggested edits</dt>
          <dd>{plan.edits.length}</dd>
        </div>
        <div>
          <dt>Current words</dt>
          <dd>{countWords(plan.sourceText).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Draft words</dt>
          <dd>{countWords(value).toLocaleString()}</dd>
        </div>
      </dl>

      {plan.edits.length > 0 ? (
        <details className="revision-details" open={plan.edits.length <= 8}>
          <summary>
            <Check size={15} aria-hidden="true" />
            Wording changes drafted from the audit
            <span>{plan.edits.length}</span>
          </summary>
          <div className="revision-change-list">
            {plan.edits.map((edit) => (
              <article key={edit.id}>
                <div>
                  <strong>{passageLabel(edit.passageId)}</strong>
                  <span>{edit.rationale}</span>
                </div>
                <p><b>Before</b>{edit.before}</p>
                <p><b>Draft</b>{edit.after}</p>
              </article>
            ))}
          </div>
        </details>
      ) : (
        <div className="revision-no-safe-edits">
          <FilePenLine size={18} aria-hidden="true" />
          <div>
            <strong>No wording was changed automatically.</strong>
            <p>
              The remaining findings need the writer&apos;s evidence or judgment.
              Use the prompts and passage coaching while editing below.
            </p>
          </div>
        </div>
      )}

      <label className="revision-editor-label" htmlFor="revision-document">
        Editable revised document
        <span>Changes remain a draft until the matching preview is applied.</span>
      </label>
      <textarea
        aria-label="Editable revised document"
        aria-describedby="revision-safety-note revision-editor-help"
        className="revision-document-editor"
        id="revision-document"
        onChange={(event) => onChange(event.target.value)}
        spellCheck="true"
        value={value}
      />
      <p className="revision-editor-help" id="revision-editor-help">
        Keep claims, quotations, citations, names, numbers, and qualifiers accurate.
        DraftLens cannot verify new facts added here.
      </p>

      <section
        aria-labelledby="revision-preview-title"
        aria-live="polite"
        className="revision-audit-preview"
      >
        <div className="revision-audit-preview__heading">
          <span className="revision-preview-icon">
            <BarChart3 size={17} aria-hidden="true" />
          </span>
          <div>
            <span className="section-kicker">Before you apply</span>
            <h4 id="revision-preview-title">Draft audit preview</h4>
          </div>
          <span className={`revision-preview-state${previewAnalysis ? ' is-current' : ''}`}>
            {previewAnalysis ? 'Current preview' : 'Preview needed'}
          </span>
        </div>

        {previewAnalysis && comparison ? (
          <>
            <div className="revision-comparison">
              <article>
                <span>Current audit</span>
                <strong>{coverageLabel(currentAnalysis)}</strong>
                <small>AI-pattern coverage</small>
                <dl>
                  <div><dt>Pattern intensity</dt><dd>{currentAnalysis.patternIntensity}</dd></div>
                  <div><dt>Reportable passages</dt><dd>{currentAnalysis.flaggedPassages.length}</dd></div>
                  <div><dt>Qualifying words</dt><dd>{currentAnalysis.stats.qualifyingWordCount.toLocaleString()}</dd></div>
                </dl>
              </article>
              <ArrowRight className="revision-comparison__arrow" size={19} aria-hidden="true" />
              <article>
                <span>Draft audit</span>
                <strong>{coverageLabel(previewAnalysis)}</strong>
                <small>AI-pattern coverage</small>
                <dl>
                  <div><dt>Pattern intensity</dt><dd>{previewAnalysis.patternIntensity}</dd></div>
                  <div><dt>Reportable passages</dt><dd>{previewAnalysis.flaggedPassages.length}</dd></div>
                  <div><dt>Qualifying words</dt><dd>{previewAnalysis.stats.qualifyingWordCount.toLocaleString()}</dd></div>
                </dl>
              </article>
            </div>
            <div className={`revision-preview-outcome revision-preview-outcome--${comparison.direction}`}>
              <strong>{comparison.headline}</strong>
              <p>{comparison.detail}</p>
            </div>
          </>
        ) : (
          <div className="revision-preview-empty">
            <strong>The draft changed after its last preview.</strong>
            <p>
              Preview this exact text to see whether coverage, reportable passages,
              or pattern intensity changed. The document will not be modified.
            </p>
          </div>
        )}
      </section>

      <details className="revision-details revision-guidance">
        <summary>
          <FilePenLine size={15} aria-hidden="true" />
          Evidence-dependent revision prompts
          <span>{plan.guidance.length}</span>
        </summary>
        <div className="revision-guidance-list">
          {plan.guidance.map((item) => (
            <article key={item.signalId}>
              <strong>{item.title}</strong>
              <p>{item.instruction}</p>
            </article>
          ))}
        </div>
      </details>

      <div className="revision-lab__actions">
        <button
          className="quiet-button"
          onClick={() => onChange(plan.previewText)}
          type="button"
        >
          <Sparkles size={15} aria-hidden="true" />
          Rebuild {mode === 'comprehensive' ? 'comprehensive' : 'conservative'} draft
        </button>
        <button
          className="quiet-button"
          onClick={() => onChange(plan.sourceText)}
          type="button"
        >
          <RotateCcw size={15} aria-hidden="true" />
          Use current wording
        </button>
        {canLoadBaseline && (
          <button
            className="quiet-button"
            onClick={() => onChange(baselineText)}
            type="button"
          >
            <RotateCcw size={15} aria-hidden="true" />
            Load analysed original
          </button>
        )}
        <button
          className="quiet-button"
          onClick={onPreview}
          type="button"
        >
          <BarChart3 size={16} aria-hidden="true" />
          {previewAnalysis ? 'Refresh draft audit' : 'Preview draft audit'}
        </button>
        <button
          className="primary-button"
          disabled={!changed || previewAnalysis === null}
          onClick={onApply}
          type="button"
        >
          <FilePenLine size={16} aria-hidden="true" />
          Apply previewed draft
        </button>
      </div>
    </div>
  )
}
