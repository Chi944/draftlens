import {
  Check,
  FilePenLine,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { RevisionPlan } from '../lib/revision'

interface RevisionLabProps {
  plan: RevisionPlan
  value: string
  baselineText: string | null
  onChange: (value: string) => void
  onApply: () => void
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
}

function passageLabel(passageId: string): string {
  const number = passageId.match(/(\d+)$/u)?.[1]
  return number ? `Passage ${number}` : 'Detected passage'
}

export function RevisionLab({
  plan,
  value,
  baselineText,
  onChange,
  onApply,
}: RevisionLabProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const changed = value !== plan.sourceText
  const canLoadBaseline =
    baselineText !== null && baselineText !== plan.sourceText

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
            Review a conservative starter draft, make it accurate and personal,
            then apply it to the document and run the audit again.
          </p>
        </div>
      </div>

      <div className="revision-safety" id="revision-safety-note">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>{plan.warnings[0]}</p>
      </div>

      <dl className="revision-stats" aria-label="Revision draft statistics">
        <div>
          <dt>Reportable passages</dt>
          <dd>{plan.passageCount}</dd>
        </div>
        <div>
          <dt>Conservative edits</dt>
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
        <details className="revision-details" open>
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
              The detected patterns need the writer&apos;s evidence or judgment.
              Use the prompts and passage coaching while editing below.
            </p>
          </div>
        </div>
      )}

      <label className="revision-editor-label" htmlFor="revision-document">
        Editable revised document
        <span>Nothing is applied until you choose Apply and re-audit.</span>
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
        Keep claims, quotations, citations, and qualifiers accurate. DraftLens
        cannot verify new facts added here.
      </p>

      <details className="revision-details revision-guidance">
        <summary>
          <FilePenLine size={15} aria-hidden="true" />
          Audit-guided prompts
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
          Rebuild safe draft
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
          className="primary-button"
          disabled={!changed}
          onClick={onApply}
          type="button"
        >
          <FilePenLine size={16} aria-hidden="true" />
          Apply and re-audit
        </button>
      </div>
    </div>
  )
}
