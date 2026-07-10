import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenText,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  Fingerprint,
  Flag,
  Info,
  Lightbulb,
  LockKeyhole,
  PenLine,
  RefreshCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Undo2,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react'
import { SAMPLE_REPORT, SAMPLE_REPORT_TITLE } from './data/sample'
import { RevisionLab } from './components/RevisionLab'
import { analyzeText } from './lib/analyzer'
import {
  ACCEPTED_FILE_TYPES,
  FILE_ACCEPT,
  extractTextFromFile,
} from './lib/document'
import { PASSAGE_BANDS, passageBandLabel } from './lib/passage-bands'
import {
  applyAuditRevisionDraft,
  planAuditRevisions,
  type RevisionMode,
  type RevisionPlan,
} from './lib/revision'
import type {
  AnalysisResult,
  Classification,
  FlaggedPassage,
  RevisionCoaching,
} from './lib/types'

type DocumentFilter = 'all' | 'flagged' | 'revise'

interface RevisionPreviewSnapshot {
  sourceText: string
  draftText: string
  analysis: AnalysisResult
}

const MIN_RECOMMENDED_WORDS = 300

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
}

function scrollToTop() {
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

function classificationLabel(
  classification: Classification,
  status: AnalysisResult['coverage']['status'],
) {
  if (status === 'insufficient-prose') return 'Not enough qualifying prose'
  if (status === 'out-of-range') return 'Outside the supported range'
  if (status === 'below-reporting-threshold') return 'Below reporting threshold'
  if (classification === 'high') return 'High estimated coverage'
  if (classification === 'mixed') return 'Reviewable estimated coverage'
  return 'No detected coverage'
}

function confidenceTone(level: AnalysisResult['confidence']['level']) {
  if (level === 'high') return 'teal'
  if (level === 'medium') return 'amber'
  return 'muted'
}

function ScoreRing({
  score,
  classification,
  coverage,
}: Pick<AnalysisResult, 'score' | 'classification' | 'coverage'>) {
  const activeTicks =
    coverage.status === 'exact' ? Math.round(score / 5) : 0
  const showPercent =
    coverage.status === 'exact' ||
    coverage.status === 'below-reporting-threshold'
  const ringValue =
    coverage.status === 'exact'
      ? String(score)
      : coverage.status === 'below-reporting-threshold'
        ? '*'
        : '—'

  return (
    <div
      className={`score-ring score-ring--${classification}`}
      role="img"
      aria-label={`Estimated AI-pattern coverage: ${coverage.displayLabel}`}
    >
      {Array.from({ length: 20 }, (_, index) => (
        <span
          aria-hidden="true"
          className={`score-ring__tick${index < activeTicks ? ' is-active' : ''}`}
          key={index}
          style={{ '--tick-angle': `${index * 18}deg` } as CSSProperties}
        />
      ))}
      <div className="score-ring__center">
        <strong>{ringValue}</strong>
        <span>{showPercent ? '%' : 'status'}</span>
      </div>
    </div>
  )
}

interface HighlightedDocumentProps {
  text: string
  passages: FlaggedPassage[]
  selectedId: string | null
  onSelect: (passage: FlaggedPassage) => void
}

function HighlightedDocument({
  text,
  passages,
  selectedId,
  onSelect,
}: HighlightedDocumentProps) {
  const content = useMemo(() => {
    const ordered = [...passages].sort((a, b) => a.start - b.start)
    const fragments: ReactNode[] = []
    let cursor = 0

    ordered.forEach((passage, index) => {
      if (passage.start > cursor) {
        fragments.push(
          <span key={`text-${cursor}`}>{text.slice(cursor, passage.start)}</span>,
        )
      }

      const start = Math.max(cursor, passage.start)
      if (passage.end > start) {
        fragments.push(
          <button
            aria-label={`Open coaching for ${passageBandLabel(passage.classification)} passage ${index + 1}`}
            aria-pressed={selectedId === passage.id}
            className={`document-highlight document-highlight--${passage.classification}${
              selectedId === passage.id ? ' is-selected' : ''
            }`}
            key={passage.id}
            onClick={() => onSelect(passage)}
            type="button"
          >
            {text.slice(start, passage.end)}
            <span className="document-highlight__label" aria-hidden="true">
              <Flag size={11} strokeWidth={2.5} />
              {passageBandLabel(passage.classification)}
            </span>
          </button>,
        )
        cursor = passage.end
      }
    })

    if (cursor < text.length) {
      fragments.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>)
    }

    return fragments
  }, [onSelect, passages, selectedId, text])

  return <div className="document-text">{content}</div>
}

function CoachingCard({ coaching }: { coaching: RevisionCoaching }) {
  return (
    <article className="coaching-card">
      <div className="coaching-card__heading">
        <span className={`priority priority--${coaching.priority}`}>
          {coaching.priority} priority
        </span>
        <h4>{coaching.title}</h4>
      </div>
      <p>{coaching.rationale}</p>
      <div className="coaching-action">
        <span>Revision move</span>
        <p>{coaching.action}</p>
      </div>
      {coaching.example && (
        <div className="coaching-example">
          <span>For example</span>
          <p>{coaching.example}</p>
        </div>
      )}
    </article>
  )
}

function App() {
  const [text, setText] = useState('')
  const [sourceName, setSourceName] = useState('Untitled draft')
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [selectedPassageId, setSelectedPassageId] = useState<string | null>(null)
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>('all')
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [error, setError] = useState('')
  const [revisionPlan, setRevisionPlan] = useState<RevisionPlan | null>(null)
  const [revisionDraft, setRevisionDraft] = useState('')
  const [revisionBaseline, setRevisionBaseline] = useState<string | null>(null)
  const [revisionHistory, setRevisionHistory] = useState<string[]>([])
  const [revisionStatus, setRevisionStatus] = useState('')
  const [revisionMode, setRevisionMode] =
    useState<RevisionMode>('comprehensive')
  const [revisionPreview, setRevisionPreview] =
    useState<RevisionPreviewSnapshot | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importRequestIdRef = useRef(0)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const reviewSectionRef = useRef<HTMLElement>(null)
  const wordCount = countWords(text)
  const acceptedTypeLabel = ACCEPTED_FILE_TYPES.map((type) =>
    type.slice(1).toUpperCase(),
  ).join(', ')

  const selectedPassage =
    analysis?.flaggedPassages.find((passage) => passage.id === selectedPassageId) ??
    analysis?.flaggedPassages[0] ??
    null

  const selectedPassageIndex = selectedPassage
    ? (analysis?.flaggedPassages.findIndex(
        (passage) => passage.id === selectedPassage.id,
      ) ?? -1) + 1
    : 0

  const relevantCoaching = useMemo(() => {
    if (!analysis) return []
    if (!selectedPassage) return analysis.coaching.slice(0, 3)

    const signalIds = new Set(selectedPassage.signals.map((signal) => signal.id))
    const matched = analysis.coaching.filter((item) =>
      item.relatedSignalIds.some((signalId) => signalIds.has(signalId)),
    )
    return (matched.length ? matched : analysis.coaching).slice(0, 3)
  }, [analysis, selectedPassage])

  useEffect(() => {
    if (analysis) resultsHeadingRef.current?.focus({ preventScroll: true })
  }, [analysis])

  const resetRevisionSession = () => {
    setRevisionPlan(null)
    setRevisionDraft('')
    setRevisionBaseline(null)
    setRevisionHistory([])
    setRevisionStatus('')
    setRevisionMode('comprehensive')
    setRevisionPreview(null)
  }

  const loadFile = async (file: File) => {
    const requestId = importRequestIdRef.current + 1
    importRequestIdRef.current = requestId
    setError('')
    setIsImporting(true)
    try {
      const document = await extractTextFromFile(file)
      if (requestId !== importRequestIdRef.current) return
      setText(document.text)
      setSourceName(document.name)
      setAnalysis(null)
      setSelectedPassageId(null)
      setExportError('')
      resetRevisionSession()
    } catch (cause) {
      if (requestId !== importRequestIdRef.current) return
      setError(cause instanceof Error ? cause.message : 'We could not read that file.')
    } finally {
      if (requestId === importRequestIdRef.current) {
        setIsImporting(false)
        setIsDragging(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void loadFile(file)
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) void loadFile(file)
    else setIsDragging(false)
  }

  const loadSample = () => {
    importRequestIdRef.current += 1
    setIsImporting(false)
    setIsDragging(false)
    setText(SAMPLE_REPORT)
    setSourceName(SAMPLE_REPORT_TITLE)
    setError('')
    setAnalysis(null)
    setSelectedPassageId(null)
    setExportError('')
    resetRevisionSession()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const runAnalysis = () => {
    if (!text.trim()) {
      setError('Add some writing or import a report before analysing.')
      return
    }

    try {
      const result = analyzeText(text)
      setAnalysis(result)
      setSelectedPassageId(result.flaggedPassages[0]?.id ?? null)
      setDocumentFilter('all')
      setError('')
      setExportError('')
      setRevisionPlan(null)
      setRevisionDraft('')
      setRevisionBaseline(text)
      setRevisionHistory([])
      setRevisionStatus('')
      setRevisionMode('comprehensive')
      setRevisionPreview(null)
      scrollToTop()
    } catch {
      setError('The analysis could not be completed. Please check the text and try again.')
    }
  }

  const editDraft = () => {
    setAnalysis(null)
    setSelectedPassageId(null)
    setExportError('')
    setError('')
    resetRevisionSession()
    scrollToTop()
  }

  const prepareRevisionWorkspace = (mode: RevisionMode) => {
    if (!analysis || analysis.flaggedPassages.length === 0) return null

    const plan = planAuditRevisions(text, analysis, { mode })
    if (plan.status === 'stale-audit' || plan.status === 'unavailable') {
      setRevisionStatus(plan.warnings[0])
      return null
    }

    try {
      const previewAnalysis = analyzeText(plan.previewText)
      setRevisionPlan(plan)
      setRevisionMode(mode)
      setRevisionDraft(plan.previewText)
      setRevisionPreview({
        sourceText: text,
        draftText: plan.previewText,
        analysis: previewAnalysis,
      })
      setRevisionBaseline((current) => current ?? text)
      setDocumentFilter('revise')
      return plan
    } catch {
      setRevisionStatus('The revision draft could not be prepared in this browser.')
      return null
    }
  }

  const openRevisionLab = () => {
    if (!analysis || analysis.flaggedPassages.length === 0) return

    if (revisionPlan?.sourceText === text) {
      setDocumentFilter('revise')
      setRevisionStatus('Revision Lab opened. No changes have been applied.')
      reviewSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      })
      return
    }

    const plan = prepareRevisionWorkspace('comprehensive')
    if (!plan) return

    setRevisionStatus(
      plan.edits.length > 0
        ? `Revision Lab opened with ${plan.edits.length} comprehensive clarity ${plan.edits.length === 1 ? 'edit' : 'edits'} for review.`
        : 'Revision Lab opened with audit-guided prompts. No wording was changed automatically.',
    )
    reviewSectionRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const changeRevisionMode = (mode: RevisionMode) => {
    const plan = prepareRevisionWorkspace(mode)
    if (!plan) return
    setRevisionStatus(
      `${mode === 'comprehensive' ? 'Comprehensive clarity' : 'Conservative cleanup'} draft rebuilt with ${plan.edits.length} ${plan.edits.length === 1 ? 'edit' : 'edits'} for review.`,
    )
  }

  const changeRevisionDraft = (value: string) => {
    setRevisionDraft(value)
    setRevisionPreview(null)
  }

  const previewRevisionDraft = () => {
    if (!revisionPlan) return

    try {
      const previewAnalysis = analyzeText(revisionDraft)
      setRevisionPreview({
        sourceText: text,
        draftText: revisionDraft,
        analysis: previewAnalysis,
      })
      setRevisionStatus('Draft audit preview refreshed. No changes have been applied.')
    } catch {
      setRevisionPreview(null)
      setRevisionStatus('The draft audit preview could not be completed.')
    }
  }

  const applyRevisionDraft = () => {
    if (!analysis || !revisionPlan) return
    if (
      !revisionPreview ||
      revisionPreview.sourceText !== text ||
      revisionPreview.draftText !== revisionDraft
    ) {
      setRevisionStatus('Preview this exact draft audit before applying it.')
      return
    }

    const applied = applyAuditRevisionDraft(text, revisionPlan, revisionDraft)
    if (applied.status === 'stale-plan') {
      setRevisionStatus(
        'The document changed after this revision draft was prepared. Run the audit again before applying it.',
      )
      return
    }
    if (applied.text === text) return

    const previousText = text
    const result = revisionPreview.analysis
    setRevisionHistory((history) => [...history, previousText].slice(-10))
    setText(applied.text)
    setAnalysis(result)
    setSelectedPassageId(result.flaggedPassages[0]?.id ?? null)
    setDocumentFilter('all')
    setRevisionPlan(null)
    setRevisionDraft('')
    setRevisionPreview(null)
    setRevisionStatus('Previewed revision applied. The document audit is current.')
    setError('')
    setExportError('')
    scrollToTop()
  }

  const undoLastRevision = () => {
    const previousText = revisionHistory.at(-1)
    if (previousText === undefined) return

    try {
      const result = analyzeText(previousText)
      setText(previousText)
      setAnalysis(result)
      setSelectedPassageId(result.flaggedPassages[0]?.id ?? null)
      setDocumentFilter('all')
      setRevisionPlan(null)
      setRevisionDraft('')
      setRevisionPreview(null)
      setRevisionHistory((history) => history.slice(0, -1))
      setRevisionStatus('The last applied revision was undone and the audit was refreshed.')
      setError('')
      setExportError('')
      scrollToTop()
    } catch {
      setRevisionStatus('The previous draft could not be restored.')
    }
  }

  const exportWordReport = async () => {
    if (!analysis || isExporting) return

    setIsExporting(true)
    setExportError('')
    try {
      const { downloadAuditReportDocx } = await import(
        './lib/export-report'
      )
      await downloadAuditReportDocx({ text, sourceName, analysis })
    } catch {
      setExportError(
        'The Word report could not be generated. Please try again in this browser.',
      )
    } finally {
      setIsExporting(false)
    }
  }

  const startOver = () => {
    importRequestIdRef.current += 1
    setText('')
    setSourceName('Untitled draft')
    setAnalysis(null)
    setSelectedPassageId(null)
    setDocumentFilter('all')
    setExportError('')
    setError('')
    resetRevisionSession()
    if (fileInputRef.current) fileInputRef.current.value = ''
    scrollToTop()
  }

  return (
    <div className="app-shell">
      <div aria-atomic="true" aria-live="polite" className="visually-hidden" role="status">
        {isImporting
          ? 'Reading the selected document.'
          : isExporting
            ? 'Preparing the Word audit report.'
            : revisionStatus
              ? revisionStatus
              : analysis
                ? `Analysis complete. Estimated AI-pattern coverage ${analysis.coverage.displayLabel}.${
                    selectedPassage
                      ? ` Passage ${selectedPassageIndex} selected for coaching.`
                      : ''
                  }`
                : ''}
      </div>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <div className="brand" aria-label="DraftLens home">
            <span className="brand__mark" aria-hidden="true">
              <ScanSearch size={22} strokeWidth={2.2} />
            </span>
            <span className="brand__name">DraftLens</span>
            <span className="brand__edition">Writing review</span>
          </div>
          <div
            aria-label="Private, in-browser review"
            className="privacy-badge"
            role="note"
          >
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Private, in-browser review</span>
          </div>
        </div>
      </header>

      {!analysis ? (
        <main id="main-content" className="entry-page">
          <section className="entry-hero" aria-labelledby="page-title">
            <div className="eyebrow">
              <span />
              Forensic writing review
            </div>
            <h1 id="page-title">
              See the patterns.
              <br />
              <em>Keep your voice.</em>
            </h1>
            <p>
              Estimate how much qualifying prose matches calibrated AI-writing patterns,
              inspect detected passages, and review the observable style evidence in context.
            </p>
          </section>

          <section className="entry-workspace" aria-labelledby="workspace-title">
            <div className="workspace-heading">
              <div>
                <span className="section-kicker">New review</span>
                <h2 id="workspace-title">Add your report</h2>
              </div>
              <button className="text-button" onClick={loadSample} type="button">
                <BookOpenText size={16} aria-hidden="true" />
                Load sample report
              </button>
            </div>

            <div className="entry-grid">
              <div className="editor-pane">
                <label htmlFor="report-text">Paste your writing</label>
                <div className="editor-frame">
                  <textarea
                    id="report-text"
                    onChange={(event) => {
                      importRequestIdRef.current += 1
                      setIsImporting(false)
                      setIsDragging(false)
                      setText(event.target.value)
                      setSourceName('Pasted draft')
                      setError('')
                    }}
                    placeholder="Paste an essay, report, or article here…"
                    spellCheck="true"
                    value={text}
                  />
                  <div className="editor-meta" aria-live="polite">
                    <span>{sourceName}</span>
                    <span className={wordCount < MIN_RECOMMENDED_WORDS ? 'is-caution' : ''}>
                      {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="import-pane">
                <span className="field-label">Or import a document</span>
                <label
                  className={`dropzone${isDragging ? ' is-dragging' : ''}${
                    isImporting ? ' is-loading' : ''
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setIsDragging(false)
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <input
                    accept={FILE_ACCEPT}
                    className="visually-hidden"
                    disabled={isImporting}
                    onChange={handleFileChange}
                    ref={fileInputRef}
                    type="file"
                  />
                  <span className="dropzone__icon" aria-hidden="true">
                    {isImporting ? (
                      <RefreshCcw className="spin" size={25} />
                    ) : (
                      <UploadCloud size={25} />
                    )}
                  </span>
                  <strong>{isImporting ? 'Reading your document…' : 'Drop a file here'}</strong>
                  <span>
                    or <u>choose a file</u> from your device
                  </span>
                  <small>{acceptedTypeLabel} · up to 10 MB</small>
                </label>

                <div className="privacy-note">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <p>
                    <strong>Your draft stays on this device.</strong>
                    Files are read locally and are not uploaded by DraftLens.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="error-message" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError('')} type="button">
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="workspace-footer">
              <div className="estimate-note">
                <Info size={16} aria-hidden="true" />
                <span>
                  This is an independent coverage estimate, not proof of AI authorship.
                  {wordCount > 0 && wordCount < MIN_RECOMMENDED_WORDS
                    ? ` At least ${MIN_RECOMMENDED_WORDS} qualifying prose words are required for a reportable result.`
                    : ''}
                </span>
              </div>
              <button
                className="primary-button"
                disabled={!text.trim() || isImporting}
                onClick={runAnalysis}
                type="button"
              >
                Analyse writing
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className="trust-strip" aria-label="How DraftLens works">
            <article>
              <span>01</span>
              <div>
                <h3>Pattern, not provenance</h3>
                <p>Examines observable style signals without claiming to know who wrote it.</p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>Sentence-level evidence</h3>
                <p>Shows exactly what raised the estimate, with no black-box verdict.</p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>Authorship-first coaching</h3>
                <p>Prompts stronger details, reasoning, and voice instead of cosmetic rewrites.</p>
              </div>
            </article>
          </section>
        </main>
      ) : (
        <main id="main-content" className="results-page">
          <div className="results-heading">
            <div>
              <button className="back-button" onClick={editDraft} type="button">
                <ArrowLeft size={15} aria-hidden="true" />
                Back to editor
              </button>
              <span className="section-kicker">Analysis report</span>
              <h1 ref={resultsHeadingRef} tabIndex={-1}>{sourceName}</h1>
              <p>
                Reviewed {analysis.stats.qualifyingWordCount.toLocaleString()} qualifying
                prose words; excluded {analysis.stats.excludedWordCount.toLocaleString()} of{' '}
                {analysis.stats.wordCount.toLocaleString()} total words.
              </p>
            </div>
            <div className="results-actions">
              {analysis.flaggedPassages.length > 0 && (
                <button
                  className="secondary-button"
                  onClick={openRevisionLab}
                  type="button"
                >
                  <Sparkles size={16} aria-hidden="true" />
                  Revision Lab
                </button>
              )}
              <button
                aria-busy={isExporting}
                className="quiet-button"
                disabled={isExporting}
                onClick={() => void exportWordReport()}
                type="button"
              >
                <Download size={16} aria-hidden="true" />
                {isExporting ? 'Preparing Word report...' : 'Export Word report'}
              </button>
              <button className="quiet-button" onClick={editDraft} type="button">
                <PenLine size={16} aria-hidden="true" />
                Edit draft
              </button>
              {revisionHistory.length > 0 && (
                <button className="quiet-button" onClick={undoLastRevision} type="button">
                  <Undo2 size={16} aria-hidden="true" />
                  Undo revision
                </button>
              )}
              <button className="quiet-button" onClick={startOver} type="button">
                <RefreshCcw size={16} aria-hidden="true" />
                Start over
              </button>
            </div>
          </div>

          {revisionStatus && (
            <div className="revision-status-message" role="status">
              <Info size={17} aria-hidden="true" />
              <span>{revisionStatus}</span>
              <button
                aria-label="Dismiss revision status"
                onClick={() => setRevisionStatus('')}
                type="button"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          )}

          {exportError && (
            <div className="error-message results-error" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <span>{exportError}</span>
              <button
                aria-label="Dismiss export error"
                onClick={() => setExportError('')}
                type="button"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          )}

          <section className="overview-grid" aria-labelledby="overview-title">
            <h2 className="visually-hidden" id="overview-title">
              Analysis overview
            </h2>
            <article className="score-card">
              <div className="score-card__heading">
                <span className="section-kicker">Estimated AI-pattern coverage</span>
                <span
                  className="icon-info"
                  title="The share of qualifying prose words inside passages that crossed DraftLens' calibrated threshold; this is not an authorship probability."
                  role="note"
                  aria-label="About estimated AI-pattern coverage"
                >
                  <Info size={16} />
                </span>
              </div>
              <div className="score-card__body">
                <ScoreRing
                  classification={analysis.classification}
                  coverage={analysis.coverage}
                  score={analysis.score}
                />
                <div className="score-copy">
                  <span className={`risk-label risk-label--${analysis.classification}`}>
                    {classificationLabel(
                      analysis.classification,
                      analysis.coverage.status,
                    )}
                  </span>
                  <h3>{analysis.summary}</h3>
                  <p>
                    The denominator includes long-form prose only. Headings, list fragments,
                    unsupported-language text, and the bibliography are excluded. This
                    estimate cannot determine authorship or serve as proof.
                  </p>
                </div>
              </div>
            </article>

            <article className="confidence-card">
              <div className="confidence-card__top">
                <span className={`confidence-icon confidence-icon--${confidenceTone(analysis.confidence.level)}`}>
                  <Fingerprint size={22} aria-hidden="true" />
                </span>
                <div>
                  <span className="section-kicker">Estimate confidence</span>
                  <h3>{analysis.confidence.label}</h3>
                </div>
                <strong>{analysis.confidence.score}%</strong>
              </div>
              <div className="confidence-meter" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <span
                    className={index < Math.round(analysis.confidence.score / 10) ? 'is-active' : ''}
                    key={index}
                  />
                ))}
              </div>
              <p>{analysis.confidence.reason}</p>
              <div className="estimate-disclaimer">
                <CircleAlert size={16} aria-hidden="true" />
                <span>Estimate only — false positives and false negatives are possible.</span>
              </div>
            </article>
          </section>

          <section className="stat-grid" aria-label="Document statistics">
            <article>
              <span className="stat-icon"><FileText size={18} aria-hidden="true" /></span>
              <div><strong>{analysis.stats.qualifyingWordCount.toLocaleString()}</strong><span>Qualifying prose words</span></div>
            </article>
            <article>
              <span className="stat-icon stat-icon--coral"><Flag size={18} aria-hidden="true" /></span>
              <div><strong>{analysis.stats.detectedWordCount.toLocaleString()}</strong><span>Words in detected passages</span></div>
            </article>
            <article>
              <span className="stat-icon stat-icon--amber"><BarChart3 size={18} aria-hidden="true" /></span>
              <div><strong>{analysis.patternIntensity}</strong><span>Pattern intensity / 100</span></div>
            </article>
            <article>
              <span className="stat-icon stat-icon--teal"><Fingerprint size={18} aria-hidden="true" /></span>
              <div><strong>{analysis.stats.excludedWordCount.toLocaleString()}</strong><span>Excluded non-prose words</span></div>
            </article>
          </section>

          <section className="signals-section" aria-labelledby="signals-title">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">Most influential markers</span>
                <h2 id="signals-title">Top writing signals</h2>
              </div>
              <p>Observable patterns that contributed most to this estimate.</p>
            </div>
            {analysis.topSignals.length > 0 ? (
              <div className="signal-grid">
                {analysis.topSignals.slice(0, 3).map((signal, index) => (
                  <article className="signal-card" key={signal.id}>
                    <div className="signal-card__number">0{index + 1}</div>
                    <div className="signal-card__content">
                      <div>
                        <h3>{signal.label}</h3>
                        <span>{signal.affectedSentenceCount} affected sentences</span>
                      </div>
                      <p>{signal.description}</p>
                      {signal.evidence[0] && (
                        <div className="evidence-line">
                          <span>Observed</span>
                          <q>{signal.evidence[0]}</q>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-signals">
                <Check size={20} aria-hidden="true" />
                <p>No recurring writing signal stood out in this draft.</p>
              </div>
            )}
          </section>

          <section
            className="review-section"
            aria-labelledby="review-title"
            ref={reviewSectionRef}
          >
            <div className="section-heading-row review-heading">
              <div>
                <span className="section-kicker">Passage review</span>
                <h2 id="review-title">Read the evidence in context</h2>
              </div>
              <div className="filter-control" aria-label="Document view">
                <button
                  aria-pressed={documentFilter === 'all'}
                  className={documentFilter === 'all' ? 'is-active' : ''}
                  onClick={() => setDocumentFilter('all')}
                  type="button"
                >
                  Full document
                </button>
                <button
                  aria-pressed={documentFilter === 'flagged'}
                  className={documentFilter === 'flagged' ? 'is-active' : ''}
                  onClick={() => setDocumentFilter('flagged')}
                  type="button"
                >
                  Flagged only
                  <span>{analysis.flaggedPassages.length}</span>
                </button>
                {analysis.flaggedPassages.length > 0 && (
                  <button
                    aria-pressed={documentFilter === 'revise'}
                    className={documentFilter === 'revise' ? 'is-active' : ''}
                    onClick={openRevisionLab}
                    type="button"
                  >
                    Revision Lab
                  </button>
                )}
              </div>
            </div>

            {documentFilter !== 'revise' && (
              <div className="band-guide" role="note" aria-label="Passage band definitions">
                <p>
                  <span className="risk-label risk-label--mixed">Review</span>
                  {PASSAGE_BANDS.mixed.definition}
                </p>
                <p>
                  <span className="risk-label risk-label--high">Elevated</span>
                  {PASSAGE_BANDS.high.definition}
                </p>
                <small>Both are context-review cues, not findings of AI authorship.</small>
              </div>
            )}

            <div className="review-grid">
              <article className="document-panel">
                <div className="document-panel__toolbar">
                  <div>
                    <FileText size={17} aria-hidden="true" />
                    <span>{sourceName}</span>
                  </div>
                  {documentFilter === 'revise' ? (
                    <div className="revision-toolbar-note">
                      <Sparkles size={14} aria-hidden="true" />
                      Draft not applied
                    </div>
                  ) : (
                    <div className="legend" aria-label="Highlight legend">
                      <span><i className="legend__swatch legend__swatch--mixed" />Review</span>
                      <span><i className="legend__swatch legend__swatch--high" />Elevated</span>
                    </div>
                  )}
                </div>

                {documentFilter === 'revise' ? (
                  revisionPlan ? (
                    <RevisionLab
                      baselineText={revisionBaseline}
                      currentAnalysis={analysis}
                      mode={revisionMode}
                      onApply={applyRevisionDraft}
                      onChange={changeRevisionDraft}
                      onModeChange={changeRevisionMode}
                      onPreview={previewRevisionDraft}
                      plan={revisionPlan}
                      previewAnalysis={
                        revisionPreview?.sourceText === text &&
                        revisionPreview.draftText === revisionDraft
                          ? revisionPreview.analysis
                          : null
                      }
                      value={revisionDraft}
                    />
                  ) : (
                    <div className="document-empty">
                      <CircleAlert size={22} aria-hidden="true" />
                      <h3>Revision draft unavailable</h3>
                      <p>Return to the passage view and open Revision Lab again.</p>
                    </div>
                  )
                ) : documentFilter === 'all' ? (
                  <HighlightedDocument
                    onSelect={(passage) => setSelectedPassageId(passage.id)}
                    passages={analysis.flaggedPassages}
                    selectedId={selectedPassage?.id ?? null}
                    text={text}
                  />
                ) : analysis.flaggedPassages.length > 0 ? (
                  <div className="flagged-list">
                    {analysis.flaggedPassages.map((passage, index) => (
                      <button
                        aria-pressed={selectedPassage?.id === passage.id}
                        className={`flagged-excerpt${
                          selectedPassage?.id === passage.id ? ' is-selected' : ''
                        }`}
                        key={passage.id}
                        onClick={() => setSelectedPassageId(passage.id)}
                        type="button"
                      >
                        <span className={`flagged-excerpt__index flagged-excerpt__index--${passage.classification}`}>
                          Passage {index + 1} / {passageBandLabel(passage.classification)}
                        </span>
                        <q>{passage.text}</q>
                        <span className={`flagged-excerpt__score flagged-excerpt__score--${passage.classification}`}>
                          {passage.score}/100 local
                          <ChevronRight size={15} aria-hidden="true" />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="document-empty">
                    <Check size={22} aria-hidden="true" />
                    <h3>
                      {analysis.coverage.status === 'below-reporting-threshold'
                        ? 'Highlights withheld below 20%'
                        : analysis.coverage.status === 'insufficient-prose'
                          ? 'More qualifying prose is needed'
                          : 'No detected passages'}
                    </h3>
                    <p>
                      {analysis.coverage.status === 'below-reporting-threshold'
                        ? 'Low-coverage results are suppressed because isolated highlights carry a higher false-positive risk.'
                        : analysis.coverage.status === 'insufficient-prose'
                          ? 'Add at least 300 words of paragraph-based prose for a reportable estimate.'
                          : 'This draft did not cross the calibrated passage threshold.'}
                    </p>
                  </div>
                )}
              </article>

              <aside className="coaching-panel" aria-labelledby="coaching-title">
                <div className="coaching-panel__heading">
                  <span className="coaching-icon"><Lightbulb size={19} aria-hidden="true" /></span>
                  <div>
                    <span className="section-kicker">Writing coach</span>
                    <h2 id="coaching-title">
                      {selectedPassage ? `Passage ${selectedPassageIndex}` : 'Revision ideas'}
                    </h2>
                  </div>
                </div>

                {selectedPassage ? (
                  <>
                    <blockquote>{selectedPassage.text}</blockquote>
                    <div className="passage-score-row">
                      <span className={`risk-label risk-label--${selectedPassage.classification}`}>
                        {passageBandLabel(selectedPassage.classification)}
                      </span>
                      <strong>{selectedPassage.score}/100 weighted local estimate</strong>
                    </div>

                    <div className="reason-list">
                      <h3>Why it was flagged</h3>
                      {selectedPassage.signals.map((signal) => (
                        <article key={signal.id}>
                          <div>
                            <span className="reason-dot" aria-hidden="true" />
                            <h4>{signal.label}</h4>
                          </div>
                          <p>{signal.description}</p>
                          {signal.evidence.length > 0 && (
                            <div className="evidence-tags" aria-label="Examples found">
                              {signal.evidence.slice(0, 3).map((item, index) => (
                                <span key={`${item}-${index}`}>{item}</span>
                              ))}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="coach-empty">
                    <Check size={22} aria-hidden="true" />
                    <h3>No passage needs focused review</h3>
                    <p>Use the general suggestions below to keep strengthening the draft.</p>
                  </div>
                )}

                {relevantCoaching.length > 0 && (
                  <div className="coaching-list">
                    <h3>Concrete revision suggestions</h3>
                    {relevantCoaching.map((item) => (
                      <CoachingCard coaching={item} key={item.id} />
                    ))}
                  </div>
                )}

                <div className="coach-ethics-note">
                  <Info size={15} aria-hidden="true" />
                  <span>Keep claims accurate and make every revision reflect your own thinking.</span>
                </div>
              </aside>
            </div>
          </section>

          <details className="methodology">
            <summary>
              <span><ScanSearch size={17} aria-hidden="true" />How this estimate was made</span>
              <ChevronRight size={17} aria-hidden="true" />
            </summary>
            <div className="methodology__content">
              <div>
                <h3>{analysis.methodology.name}</h3>
                <p>{analysis.methodology.description}</p>
                <p>{analysis.methodology.scoreMeaning}</p>
                {analysis.methodology.profileId && (
                  <p>Calibration profile: {analysis.methodology.profileId}</p>
                )}
              </div>
              <div>
                <h3>Important limitations</h3>
                <ul>
                  {analysis.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </main>
      )}

      <footer className="site-footer">
        <div>
          <span className="brand brand--footer">
            <ScanSearch size={18} aria-hidden="true" />
            <span className="brand__name">DraftLens</span>
          </span>
          <p>Independent writing-pattern review for thoughtful revision.</p>
        </div>
        <p>
          Not affiliated with Turnitin or any assessment platform. Results are estimates, not
          authorship determinations.
        </p>
      </footer>
    </div>
  )
}

export default App
