import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Fingerprint,
  Flag,
  Info,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
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
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { RevisionLab } from './components/RevisionLab'
import { SAMPLE_REPORT, SAMPLE_REPORT_TITLE } from './data/sample'
import { analyzeTextAsync, type AnalysisPhase } from './lib/analysis-client'
import {
  getContextualRevisionAvailability,
  requestContextualRevision,
  type ContextualRevisionIntent,
  type ContextualRevisionResult,
} from './lib/contextual-revision'
import {
  ACCEPTED_FILE_TYPES,
  FILE_ACCEPT,
  extractTextFromFile,
  type DocumentExtractionProgress,
  type ExtractedDocument,
} from './lib/document'
import { PASSAGE_BANDS, passageBandLabel } from './lib/passage-bands'
import {
  applyAuditRevisionDraft,
  planAuditRevisions,
  type RevisionMode,
  type RevisionPlan,
} from './lib/revision'
import {
  clearRecoverySnapshot,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
  type InputMode,
} from './lib/session-recovery'
import type {
  AnalysisResult,
  Classification,
  FlaggedPassage,
  ModelFactor,
} from './lib/types'

type ResultView = 'summary' | 'evidence' | 'revise'
type ExportKind = 'audit' | 'evidence' | 'clean'
type ProviderStatus = 'idle' | 'checking' | 'available' | 'unavailable'

interface RevisionPreviewSnapshot {
  sourceText: string
  draftText: string
  analysis: AnalysisResult
}

interface RevisionHistoryEntry {
  text: string
  sourceDocument: ExtractedDocument | null
}

const MIN_RECOMMENDED_WORDS = 300

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
}

function scrollToTop(): void {
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

function classificationLabel(analysis: AnalysisResult): string {
  if (analysis.coverage.status === 'unsupported-domain') {
    return analysis.domainSupport.label
  }
  if (analysis.coverage.status === 'insufficient-prose') return 'Not enough prose'
  if (analysis.coverage.status === 'out-of-range') return 'Outside supported length'
  if (analysis.coverage.status === 'below-reporting-threshold') {
    return 'Below reporting threshold'
  }
  if (analysis.classification === 'high') return 'High flagged coverage'
  if (analysis.classification === 'mixed') return 'Some flagged coverage'
  return 'No flagged coverage'
}

function resultTone(
  analysis: AnalysisResult,
): Classification | 'unsupported' {
  return analysis.coverage.status === 'unsupported-domain'
    ? 'unsupported'
    : analysis.classification
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

function formatExtractionMethod(method: ExtractedDocument['receipt']['method']): string {
  const labels: Record<ExtractedDocument['receipt']['method'], string> = {
    'plain-text': 'Plain text',
    'docx-text': 'Word text',
    'pdf-text': 'PDF text',
    'pdf-ocr': 'Local OCR',
    'pdf-mixed': 'PDF text + local OCR',
  }
  return labels[method]
}

function pageForOffset(document: ExtractedDocument | null, offset: number): number | null {
  const page = document?.pageSpans.find(
    (span) => offset >= span.start && offset < span.end,
  )
  return page?.pageNumber ?? null
}

function ScoreRing({ analysis }: { analysis: AnalysisResult }) {
  const { coverage, score } = analysis
  const activeTicks = coverage.status === 'exact' ? Math.round(score / 5) : 0
  const value =
    coverage.status === 'exact'
      ? String(score)
      : coverage.status === 'below-reporting-threshold'
        ? '*'
        : '—'

  return (
    <div
      aria-label={`Flagged prose coverage: ${coverage.displayLabel}`}
      className={`score-ring score-ring--${resultTone(analysis)}`}
      role="img"
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
        <strong>{value}</strong>
        <span>{coverage.status === 'exact' ? '%' : 'status'}</span>
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
    const fragments: ReactNode[] = []
    const ordered = [...passages].sort((left, right) => left.start - right.start)
    let cursor = 0

    ordered.forEach((passage, index) => {
      if (passage.start > cursor) {
        fragments.push(
          <span key={`text-${cursor}`}>{text.slice(cursor, passage.start)}</span>,
        )
      }
      const start = Math.max(cursor, passage.start)
      if (passage.end <= start) return
      fragments.push(
        <button
          aria-pressed={selectedId === passage.id}
          className={`document-highlight document-highlight--${passage.classification}${
            selectedId === passage.id ? ' is-selected' : ''
          }`}
          key={passage.id}
          onClick={() => onSelect(passage)}
          title={`Inspect ${passageBandLabel(passage.classification)} passage ${index + 1}`}
          type="button"
        >
          {text.slice(start, passage.end)}
          <span aria-hidden="true" className="document-highlight__label">
            <Flag size={11} strokeWidth={2.5} />
            {passageBandLabel(passage.classification)}
          </span>
        </button>,
      )
      cursor = passage.end
    })

    if (cursor < text.length) {
      fragments.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>)
    }
    return fragments
  }, [onSelect, passages, selectedId, text])

  return <div className="document-text">{content}</div>
}

function FactorList({ factors }: { factors: ModelFactor[] }) {
  if (factors.length === 0) {
    return <p className="empty-copy">No stable model contribution was available.</p>
  }

  return (
    <div className="factor-list">
      {factors.map((factor) => (
        <div className={`factor-row factor-row--${factor.direction}`} key={factor.feature}>
          <div>
            <strong>{factor.label}</strong>
            <span>Observed {factor.value.toFixed(3)}</span>
          </div>
          <span
            aria-label={`${factor.label} ${factor.direction === 'raises' ? 'raised' : factor.direction === 'lowers' ? 'lowered' : 'did not materially move'} the model score by ${Math.abs(factor.contribution).toFixed(2)} log-odds; observed value ${factor.value.toFixed(3)}`}
          >
            {factor.contribution > 0 ? '+' : ''}{factor.contribution.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  )
}

function App() {
  const initialRecovery = useMemo(() => loadRecoverySnapshot(), [])
  const [inputMode, setInputMode] = useState<InputMode>('upload')
  const [text, setText] = useState('')
  const [sourceName, setSourceName] = useState('Untitled draft')
  const [sourceDocument, setSourceDocument] = useState<ExtractedDocument | null>(null)
  const [recovery, setRecovery] = useState(initialRecovery)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [resultView, setResultView] = useState<ResultView>('summary')
  const [selectedPassageId, setSelectedPassageId] = useState<string | null>(null)
  const [reviewedPassageIds, setReviewedPassageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [isEvidenceDrawerOpen, setIsEvidenceDrawerOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] =
    useState<DocumentExtractionProgress | null>(null)
  const [ocrProgress, setOcrProgress] = useState('')
  const [enableOcr, setEnableOcr] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [error, setError] = useState('')
  const [revisionPlan, setRevisionPlan] = useState<RevisionPlan | null>(null)
  const [revisionDraft, setRevisionDraft] = useState('')
  const [revisionHistory, setRevisionHistory] = useState<RevisionHistoryEntry[]>([])
  const [revisionStatus, setRevisionStatus] = useState('')
  const [revisionMode, setRevisionMode] = useState<RevisionMode>('comprehensive')
  const [revisionPreview, setRevisionPreview] =
    useState<RevisionPreviewSnapshot | null>(null)
  const [contextualOptIn, setContextualOptIn] = useState(false)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>('idle')
  const [contextualIntent, setContextualIntent] =
    useState<ContextualRevisionIntent>('clarify')
  const [contextualResult, setContextualResult] =
    useState<ContextualRevisionResult | null>(null)
  const [contextualError, setContextualError] = useState('')
  const [isContextualLoading, setIsContextualLoading] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const evidenceDetailsButtonRef = useRef<HTMLButtonElement>(null)
  const evidenceDrawerRef = useRef<HTMLElement>(null)
  const evidenceDrawerCloseRef = useRef<HTMLButtonElement>(null)
  const evidenceDrawerOpenerRef = useRef<HTMLElement | null>(null)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const importRequestIdRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const contextualAbortRef = useRef<AbortController | null>(null)
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
  const selectedPage = selectedPassage
    ? pageForOffset(sourceDocument, selectedPassage.start)
    : null
  const passagePageReferences = useMemo(() => {
    if (!analysis || !sourceDocument) return undefined
    return Object.fromEntries(
      analysis.flaggedPassages.flatMap((passage) => {
        const page = pageForOffset(sourceDocument, passage.start)
        return page === null ? [] : [[passage.id, page]]
      }),
    )
  }, [analysis, sourceDocument])

  const relevantCoaching = useMemo(() => {
    if (!analysis) return []
    if (!selectedPassage) return analysis.coaching.slice(0, 2)
    const ids = new Set(selectedPassage.signals.map((signal) => signal.id))
    const matched = analysis.coaching.filter((item) =>
      item.relatedSignalIds.some((id) => ids.has(id)),
    )
    return (matched.length > 0 ? matched : analysis.coaching).slice(0, 2)
  }, [analysis, selectedPassage])

  useEffect(() => {
    if (analysis) return
    const timer = window.setTimeout(() => {
      if (text.trim()) saveRecoverySnapshot({ text, sourceName, inputMode })
      else clearRecoverySnapshot()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [analysis, inputMode, sourceName, text])

  useEffect(() => {
    if (analysis) resultsHeadingRef.current?.focus({ preventScroll: true })
  }, [analysis])

  useEffect(() => {
    setContextualResult(null)
    setContextualError('')
  }, [selectedPassageId])

  useEffect(() => {
    if (!isEvidenceDrawerOpen) return
    const dialog = evidenceDrawerRef.current
    if (!dialog) return
    const inertTargets = [
      ...document.querySelectorAll<HTMLElement>(
        '.site-header, .results-heading, .result-tabs, .revision-status-message, .evidence-view > .compact-heading, .passage-queue, .evidence-layout > .document-panel, .site-footer',
      ),
    ].filter((target) => !target.contains(dialog))
    const previousAriaHidden = inertTargets.map((target) =>
      target.getAttribute('aria-hidden'),
    )
    inertTargets.forEach((target) => {
      target.inert = true
      target.setAttribute('aria-hidden', 'true')
    })
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    evidenceDrawerCloseRef.current?.focus({ preventScroll: true })
    const handleDrawerKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsEvidenceDrawerOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleDrawerKey)
    return () => {
      window.removeEventListener('keydown', handleDrawerKey)
      document.body.style.overflow = previousOverflow
      inertTargets.forEach((target, index) => {
        target.inert = false
        const previous = previousAriaHidden[index]
        if (previous === null) target.removeAttribute('aria-hidden')
        else target.setAttribute('aria-hidden', previous)
      })
      window.requestAnimationFrame(() =>
        evidenceDrawerOpenerRef.current?.focus({ preventScroll: true }),
      )
    }
  }, [isEvidenceDrawerOpen])

  useEffect(() => {
    if (!contextualOptIn) {
      contextualAbortRef.current?.abort()
      setProviderStatus('idle')
      return
    }
    const controller = new AbortController()
    contextualAbortRef.current = controller
    setProviderStatus('checking')
    void getContextualRevisionAvailability(controller.signal)
      .then((available) => setProviderStatus(available ? 'available' : 'unavailable'))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setProviderStatus('unavailable')
        }
      })
    return () => controller.abort()
  }, [contextualOptIn])

  const resetRevisionSession = () => {
    setRevisionPlan(null)
    setRevisionDraft('')
    setRevisionHistory([])
    setRevisionStatus('')
    setRevisionMode('comprehensive')
    setRevisionPreview(null)
    setContextualResult(null)
    setContextualError('')
  }

  const cancelImport = () => {
    importRequestIdRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    setOcrProgress('')
    setIsDragging(false)
  }

  const loadFile = async (file: File) => {
    cancelImport()
    const requestId = importRequestIdRef.current + 1
    importRequestIdRef.current = requestId
    const controller = new AbortController()
    importAbortRef.current = controller
    setError('')
    setIsImporting(true)
    setImportProgress({ phase: 'reading', completed: 0, total: 1 })

    try {
      const localPdfOcr =
        enableOcr && file.name.toLowerCase().endsWith('.pdf')
          ? (await import('./lib/local-ocr')).createLocalPdfOcrFallback(
              ({ progress, status, pageNumber }) => {
                setOcrProgress(
                  `Page ${pageNumber}: ${status} ${Math.round(progress * 100)}%`,
                )
              },
            )
          : undefined
      const extracted = await extractTextFromFile(file, {
        signal: controller.signal,
        localPdfOcr,
        onProgress: setImportProgress,
      })
      if (requestId !== importRequestIdRef.current) return
      setText(extracted.text)
      setSourceName(extracted.name)
      setSourceDocument(extracted)
      setAnalysis(null)
      setSelectedPassageId(null)
      setExportError('')
      setRecovery(null)
      resetRevisionSession()
    } catch (cause) {
      if (requestId !== importRequestIdRef.current) return
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'We could not read that file.')
      }
    } finally {
      if (requestId === importRequestIdRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
        setOcrProgress('')
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
    cancelImport()
    setInputMode('paste')
    setText(SAMPLE_REPORT)
    setSourceName(SAMPLE_REPORT_TITLE)
    setSourceDocument(null)
    setRecovery(null)
    setError('')
    setAnalysis(null)
    setSelectedPassageId(null)
    setExportError('')
    resetRevisionSession()
  }

  const restoreRecovery = () => {
    if (!recovery) return
    setText(recovery.text)
    setSourceName(recovery.sourceName)
    setInputMode(recovery.inputMode)
    setRecovery(null)
  }

  const discardRecovery = () => {
    clearRecoverySnapshot()
    setRecovery(null)
  }

  const runAnalysis = async () => {
    if (!text.trim()) {
      setError('Add some writing before analysing.')
      return
    }
    analysisAbortRef.current?.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller
    setIsAnalyzing(true)
    setAnalysisPhase('preparing')
    setError('')

    try {
      const result = await analyzeTextAsync(text, {
        signal: controller.signal,
        onProgress: setAnalysisPhase,
      })
      if (analysisAbortRef.current !== controller) return
      setAnalysis(result)
      setSelectedPassageId(result.flaggedPassages[0]?.id ?? null)
      setReviewedPassageIds(new Set())
      setResultView('summary')
      setExportError('')
      resetRevisionSession()
      scrollToTop()
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError('The analysis could not be completed. Check the text and try again.')
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null
        setIsAnalyzing(false)
        setAnalysisPhase(null)
      }
    }
  }

  const cancelAnalysis = () => {
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null
    setIsAnalyzing(false)
    setAnalysisPhase(null)
  }

  const editDraft = () => {
    cancelAnalysis()
    setAnalysis(null)
    setSelectedPassageId(null)
    setResultView('summary')
    setExportError('')
    setError('')
    resetRevisionSession()
    scrollToTop()
  }

  const prepareRevisionWorkspace = async (
    mode: RevisionMode,
  ): Promise<RevisionPlan | null> => {
    if (!analysis || analysis.flaggedPassages.length === 0) return null
    const plan = planAuditRevisions(text, analysis, { mode })
    if (plan.status === 'stale-audit' || plan.status === 'unavailable') {
      setRevisionStatus(plan.warnings[0] ?? 'A revision plan is unavailable.')
      return null
    }
    try {
      const previewAnalysis = await analyzeTextAsync(plan.previewText)
      setRevisionPlan(plan)
      setRevisionMode(mode)
      setRevisionDraft(plan.previewText)
      setRevisionPreview({ sourceText: text, draftText: plan.previewText, analysis: previewAnalysis })
      return plan
    } catch {
      setRevisionStatus('The revision draft could not be prepared in this browser.')
      return null
    }
  }

  const openRevisionLab = async () => {
    setIsEvidenceDrawerOpen(false)
    setResultView('revise')
    if (!analysis || analysis.flaggedPassages.length === 0) return
    if (revisionPlan?.sourceText === text) return
    const plan = await prepareRevisionWorkspace('comprehensive')
    if (plan) {
      setRevisionStatus(
        plan.edits.length > 0
          ? `${plan.edits.length} tracked clarity edit${plan.edits.length === 1 ? '' : 's'} ready for review.`
          : 'No safe automatic cleanup was found. Use the evidence prompts or edit directly.',
      )
    }
  }

  const changeRevisionMode = async (mode: RevisionMode) => {
    const plan = await prepareRevisionWorkspace(mode)
    if (plan) {
      setRevisionStatus(`${plan.edits.length} tracked edit${plan.edits.length === 1 ? '' : 's'} ready.`)
    }
  }

  const changeRevisionDraft = (value: string) => {
    setRevisionDraft(value)
    setRevisionPreview(null)
  }

  const previewRevisionDraft = async () => {
    if (!revisionPlan) return
    try {
      const previewAnalysis = await analyzeTextAsync(revisionDraft)
      setRevisionPreview({ sourceText: text, draftText: revisionDraft, analysis: previewAnalysis })
      setRevisionStatus('Preview refreshed. No changes have been applied.')
    } catch {
      setRevisionPreview(null)
      setRevisionStatus('The draft preview could not be completed.')
    }
  }

  const applyRevisionDraft = () => {
    if (!analysis || !revisionPlan) return
    if (
      !revisionPreview ||
      revisionPreview.sourceText !== text ||
      revisionPreview.draftText !== revisionDraft
    ) {
      setRevisionStatus('Preview this exact draft before applying it.')
      return
    }
    const applied = applyAuditRevisionDraft(text, revisionPlan, revisionDraft)
    if (applied.status === 'stale-plan') {
      setRevisionStatus('The source changed. Run the audit again before applying this draft.')
      return
    }
    if (applied.text === text) return
    setRevisionHistory((history) => [
      ...history,
      { text, sourceDocument },
    ].slice(-10))
    setText(applied.text)
    setSourceDocument((current) =>
      current ? { ...current, pageSpans: [] } : null,
    )
    setAnalysis(revisionPreview.analysis)
    setSelectedPassageId(revisionPreview.analysis.flaggedPassages[0]?.id ?? null)
    setRevisionPlan(null)
    setRevisionDraft('')
    setRevisionPreview(null)
    setRevisionStatus('Revision applied and re-audited.')
    setResultView('summary')
    setError('')
    setExportError('')
    scrollToTop()
  }

  const undoLastRevision = async () => {
    const previous = revisionHistory.at(-1)
    if (previous === undefined) return
    try {
      const result = await analyzeTextAsync(previous.text)
      setText(previous.text)
      setSourceDocument(previous.sourceDocument)
      setAnalysis(result)
      setSelectedPassageId(result.flaggedPassages[0]?.id ?? null)
      setRevisionHistory((history) => history.slice(0, -1))
      setRevisionPlan(null)
      setRevisionDraft('')
      setRevisionPreview(null)
      setRevisionStatus('Last applied revision undone.')
      setResultView('summary')
    } catch {
      setRevisionStatus('The previous draft could not be restored.')
    }
  }

  const exportWordDocument = async (kind: ExportKind) => {
    if (!analysis || isExporting) return
    setIsExporting(true)
    setExportError('')
    try {
      const exports = await import('./lib/export-report')
      if (kind === 'clean') {
        await exports.downloadCleanDocumentDocx({
          text,
          sourceName,
          preserveSingleLineBreaks: sourceDocument?.kind !== 'pdf',
        })
      } else if (kind === 'evidence') {
        await exports.downloadHighlightedEvidenceDocx({
          text,
          sourceName,
          analysis,
          passagePageReferences,
        })
      } else {
        await exports.downloadAuditReportDocx({
          text,
          sourceName,
          analysis,
          passagePageReferences,
        })
      }
    } catch {
      setExportError('The Word document could not be generated in this browser.')
    } finally {
      setIsExporting(false)
    }
  }

  const selectPassage = (passage: FlaggedPassage) => {
    setSelectedPassageId(passage.id)
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 900px)').matches
    ) {
      evidenceDrawerOpenerRef.current = document.activeElement as HTMLElement
      setIsEvidenceDrawerOpen(true)
    }
  }

  const closeEvidenceDrawer = () => {
    setIsEvidenceDrawerOpen(false)
  }

  const handleInputTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextMode: InputMode =
      event.key === 'ArrowLeft' || event.key === 'Home' ? 'upload' : 'paste'
    setInputMode(nextMode)
    window.requestAnimationFrame(() => {
      document.getElementById(`input-tab-${nextMode}`)?.focus()
    })
  }

  const movePassage = (direction: -1 | 1) => {
    if (!analysis || analysis.flaggedPassages.length === 0) return
    const next = Math.min(
      analysis.flaggedPassages.length - 1,
      Math.max(0, selectedPassageIndex - 1 + direction),
    )
    setSelectedPassageId(analysis.flaggedPassages[next].id)
  }

  const togglePassageReviewed = () => {
    if (!selectedPassage) return
    setReviewedPassageIds((current) => {
      const next = new Set(current)
      if (next.has(selectedPassage.id)) next.delete(selectedPassage.id)
      else next.add(selectedPassage.id)
      return next
    })
  }

  const requestFocusedRevision = async () => {
    if (!selectedPassage || providerStatus !== 'available') return
    const controller = new AbortController()
    contextualAbortRef.current?.abort()
    contextualAbortRef.current = controller
    setIsContextualLoading(true)
    setContextualError('')
    setContextualResult(null)
    try {
      setContextualResult(
        await requestContextualRevision(
          selectedPassage.text,
          contextualIntent,
          controller.signal,
        ),
      )
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setContextualError(
          cause instanceof Error ? cause.message : 'The focused revision failed.',
        )
      }
    } finally {
      setIsContextualLoading(false)
    }
  }

  const stageContextualRevision = () => {
    if (!analysis || !selectedPassage || !contextualResult) return
    const revisedText = contextualResult.revisedText.trim()
    const nextText = `${text.slice(0, selectedPassage.start)}${revisedText}${text.slice(selectedPassage.end)}`
    const plan: RevisionPlan = {
      status: 'ready',
      mode: 'comprehensive',
      sourceText: text,
      previewText: nextText,
      passageCount: 1,
      edits: [
        {
          id: `contextual-${selectedPassage.id}`,
          passageId: selectedPassage.id,
          sentenceId: selectedPassage.sentenceIds[0] ?? 'contextual-passage',
          ruleIds: [],
          start: selectedPassage.start,
          end: selectedPassage.end,
          before: selectedPassage.text,
          after: revisedText,
          rationale: contextualResult.summary,
        },
      ],
      guidance: [],
      warnings: contextualResult.warnings,
    }
    setRevisionPlan(plan)
    setRevisionDraft(nextText)
    setRevisionPreview(null)
    setRevisionStatus('Focused suggestion staged as one tracked edit. Preview it before applying.')
    setContextualResult(null)
  }

  const liveStatus = isImporting
    ? `Reading document. ${ocrProgress}`
    : isAnalyzing
      ? `Analysis ${analysisPhase ?? 'preparing'}.`
      : isExporting
        ? 'Preparing Word document.'
        : ''

  return (
    <div className="app-shell">
      <div aria-atomic="true" aria-live="polite" className="visually-hidden" role="status">
        {liveStatus}
      </div>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header__inner">
          <div aria-label="DraftLens home" className="brand">
            <span aria-hidden="true" className="brand__mark"><ScanSearch size={22} /></span>
            <span className="brand__name">DraftLens</span>
            <span className="brand__edition">Writing review</span>
          </div>
          <div aria-label="Private local analysis" className="privacy-badge" role="note">
            <LockKeyhole aria-hidden="true" size={14} />
            <span>Analysis stays on this device</span>
          </div>
        </div>
      </header>

      {!analysis ? (
        <main className="entry-page entry-page--simple" id="main-content">
          <section aria-labelledby="page-title" className="entry-hero entry-hero--simple">
            <span className="section-kicker">Explainable writing review</span>
            <h1 id="page-title">Find the passages worth a closer look.</h1>
            <p>Local analysis, causal model evidence, and reviewable edits.</p>
          </section>

          <section aria-labelledby="workspace-title" className="entry-workspace entry-workspace--simple">
            <div className="workspace-heading">
              <div>
                <span className="section-kicker">New review</span>
                <h2 id="workspace-title">Add a document</h2>
              </div>
              <button className="text-button" onClick={loadSample} type="button">
                <BookOpenText aria-hidden="true" size={16} /> Try a sample
              </button>
            </div>

            {recovery && (
              <div className="recovery-banner" role="status">
                <RefreshCcw aria-hidden="true" size={17} />
                <div><strong>Unsaved draft found</strong><span>{recovery.sourceName}</span></div>
                <button onClick={restoreRecovery} type="button">Restore</button>
                <button className="text-button" onClick={discardRecovery} type="button">Discard</button>
              </div>
            )}

            <div aria-label="Document input method" className="input-tabs" role="tablist">
              <button
                aria-controls="input-panel-upload"
                aria-selected={inputMode === 'upload'}
                className={inputMode === 'upload' ? 'is-active' : ''}
                id="input-tab-upload"
                onClick={() => setInputMode('upload')}
                onKeyDown={handleInputTabKeyDown}
                role="tab"
                tabIndex={inputMode === 'upload' ? 0 : -1}
                type="button"
              >
                <UploadCloud aria-hidden="true" size={17} /> Upload
              </button>
              <button
                aria-controls="input-panel-paste"
                aria-selected={inputMode === 'paste'}
                className={inputMode === 'paste' ? 'is-active' : ''}
                id="input-tab-paste"
                onClick={() => setInputMode('paste')}
                onKeyDown={handleInputTabKeyDown}
                role="tab"
                tabIndex={inputMode === 'paste' ? 0 : -1}
                type="button"
              >
                <FileText aria-hidden="true" size={17} /> Paste text
              </button>
            </div>

            {inputMode === 'upload' ? (
              <div
                aria-labelledby="input-tab-upload"
                className="upload-workspace"
                id="input-panel-upload"
                role="tabpanel"
              >
                <label
                  className={`dropzone dropzone--simple${isDragging ? ' is-dragging' : ''}${isImporting ? ' is-loading' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
                  onDragLeave={(event) => { event.preventDefault(); setIsDragging(false) }}
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
                  <span aria-hidden="true" className="dropzone__icon">
                    {isImporting ? <LoaderCircle className="spin" size={25} /> : <UploadCloud size={25} />}
                  </span>
                  <strong>{isImporting ? 'Reading document…' : 'Drop a file or choose one'}</strong>
                  <small>{acceptedTypeLabel} · up to 10 MB</small>
                </label>

                <label className="ocr-option">
                  <input checked={enableOcr} onChange={(event) => setEnableOcr(event.target.checked)} type="checkbox" />
                  <span><strong>Read scanned PDF pages locally</strong><small>OCR loads only when a page has no usable text.</small></span>
                </label>

                {isImporting && importProgress && (
                  <div aria-label="Document import progress" className="job-progress" role="group">
                    <div>
                      <span>{ocrProgress || `${importProgress.phase} ${importProgress.completed}/${importProgress.total}`}</span>
                      <button onClick={cancelImport} type="button">Cancel</button>
                    </div>
                    <progress max={Math.max(1, importProgress.total)} value={importProgress.completed} />
                  </div>
                )}

                {sourceDocument && !isImporting && (
                  <div className="import-receipt" aria-label="Import receipt" role="group">
                    <FileCheck2 aria-hidden="true" size={20} />
                    <div>
                      <strong>{sourceDocument.name}</strong>
                      <span>
                        {formatExtractionMethod(sourceDocument.receipt.method)} · {formatBytes(sourceDocument.source.sizeBytes)}
                        {sourceDocument.pageCount ? ` · ${sourceDocument.pageCount} pages` : ''}
                      </span>
                      <small>Headers, page numbers, contents entries, and references are excluded where detected.</small>
                    </div>
                    <Check aria-label="Import complete" size={18} />
                    {sourceDocument.receipt.warnings.map((warning) => (
                      <p className="import-warning" key={warning.code}>{warning.message}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                aria-labelledby="input-tab-paste"
                className="editor-pane editor-pane--simple"
                id="input-panel-paste"
                role="tabpanel"
              >
                <label htmlFor="report-text">Paste your writing</label>
                <div className="editor-frame">
                  <textarea
                    id="report-text"
                    onChange={(event) => {
                      cancelImport()
                      setText(event.target.value)
                      setSourceName('Pasted draft')
                      setSourceDocument(null)
                      setRecovery(null)
                      setError('')
                    }}
                    placeholder="Paste an essay, report, or article…"
                    spellCheck="true"
                    value={text}
                  />
                  <div className="editor-meta">
                    <span>{sourceName}</span>
                    <span className={wordCount < MIN_RECOMMENDED_WORDS ? 'is-caution' : ''}>
                      {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="error-message" role="alert">
                <CircleAlert aria-hidden="true" size={18} /><span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError('')} type="button"><X size={16} /></button>
              </div>
            )}

            <div className="workspace-footer workspace-footer--simple">
              <p><ShieldCheck aria-hidden="true" size={16} /> Independent estimate, not proof of authorship.</p>
              {isAnalyzing ? (
                <div className="analysis-action">
                  <span><LoaderCircle className="spin" size={17} /> {analysisPhase ?? 'preparing'}…</span>
                  <button className="quiet-button" onClick={cancelAnalysis} type="button">Cancel</button>
                </div>
              ) : (
                <button className="primary-button" disabled={!text.trim() || isImporting} onClick={() => void runAnalysis()} type="button">
                  Analyse writing <ArrowRight aria-hidden="true" size={18} />
                </button>
              )}
            </div>
          </section>
        </main>
      ) : (
        <main className="results-page results-page--focused" id="main-content">
          <div className="results-heading results-heading--focused">
            <div>
              <button className="back-button" onClick={editDraft} type="button"><ArrowLeft size={15} /> Edit document</button>
              <h1 ref={resultsHeadingRef} tabIndex={-1}>{sourceName}</h1>
              <p>{analysis.stats.qualifyingWordCount.toLocaleString()} qualifying words reviewed</p>
            </div>
            <div className="results-actions">
              {revisionHistory.length > 0 && (
                <button className="quiet-button" onClick={() => void undoLastRevision()} type="button"><Undo2 size={16} /> Undo</button>
              )}
              <details className="export-menu">
                <summary aria-label="Export Word documents"><Download size={16} /> {isExporting ? 'Preparing…' : 'Export Word'}</summary>
                <div>
                  <button disabled={isExporting} onClick={() => void exportWordDocument('audit')} type="button"><ListChecks size={16} /><span><strong>Audit report</strong><small>Summary, evidence, and limits</small></span></button>
                  <button disabled={isExporting} onClick={() => void exportWordDocument('evidence')} type="button"><Eye size={16} /><span><strong>Highlighted document</strong><small>Source text with evidence</small></span></button>
                  <button disabled={isExporting} onClick={() => void exportWordDocument('clean')} type="button"><FileText size={16} /><span><strong>Clean document</strong><small>Current wording only</small></span></button>
                </div>
              </details>
            </div>
          </div>

          <nav aria-label="Review steps" className="result-tabs">
            {(['summary', 'evidence', 'revise'] as const).map((view, index) => (
              <button
                aria-current={resultView === view ? 'step' : undefined}
                className={resultView === view ? 'is-active' : ''}
                key={view}
                onClick={() => view === 'revise' ? void openRevisionLab() : setResultView(view)}
                type="button"
              >
                <span>{index + 1}</span>{view[0].toUpperCase() + view.slice(1)}
                {view === 'evidence' && analysis.flaggedPassages.length > 0 ? <em>{analysis.flaggedPassages.length}</em> : null}
              </button>
            ))}
          </nav>

          {revisionStatus && (
            <div className="revision-status-message" role="status"><Info size={17} /><span>{revisionStatus}</span><button aria-label="Dismiss status" onClick={() => setRevisionStatus('')} type="button"><X size={15} /></button></div>
          )}
          {exportError && (
            <div className="error-message results-error" role="alert"><CircleAlert size={17} /><span>{exportError}</span><button aria-label="Dismiss export error" onClick={() => setExportError('')} type="button"><X size={15} /></button></div>
          )}

          {resultView === 'summary' && (
            <section aria-labelledby="summary-title" className="summary-view">
              <h2 className="visually-hidden" id="summary-title">Analysis summary</h2>
              <div className="summary-primary">
                <article className="score-card score-card--focused">
                  <div className="score-card__body">
                    <ScoreRing analysis={analysis} />
                    <div className="score-copy">
                      <span className={`risk-label risk-label--${resultTone(analysis)}`}>{classificationLabel(analysis)}</span>
                      <h2>{analysis.coverage.displayLabel}</h2>
                      <p>{analysis.summary}</p>
                      {analysis.coverage.status === 'exact' && (
                        <div className="score-formula">
                          {analysis.stats.detectedWordCount.toLocaleString()} flagged ÷ {analysis.stats.qualifyingWordCount.toLocaleString()} qualifying words
                        </div>
                      )}
                      {analysis.coverage.status === 'unsupported-domain' && (
                        <div className="domain-warning"><CircleAlert size={17} /><span><strong>Percentage withheld</strong>{analysis.domainSupport.reason}</span></div>
                      )}
                    </div>
                  </div>
                  <p className="score-definition"><Info size={15} /> Coverage is the share of qualifying prose inside passages crossing the calibrated threshold. It is not the probability that AI wrote the document.</p>
                </article>

                <aside className="sample-card">
                  <Fingerprint size={20} />
                  <div><span>Sample sufficiency</span><strong>{analysis.confidence.label}</strong></div>
                  <p>{analysis.confidence.reason}</p>
                </aside>
              </div>

              <article className="model-evidence-card">
                <div className="compact-heading">
                  <div><span className="section-kicker">Causal model evidence</span><h2>What moved the estimate</h2></div>
                  <p>Signed terms from the calibrated model.</p>
                </div>
                <FactorList factors={analysis.modelFactors.slice(0, 6)} />
                <details>
                  <summary>Observable writing characteristics</summary>
                  <div className="characteristic-grid">
                    {analysis.writingCharacteristics.map((item) => (
                      <div key={item.id}><strong>{item.displayValue}</strong><span>{item.label}</span></div>
                    ))}
                  </div>
                </details>
              </article>

              <div className="summary-next">
                {analysis.flaggedPassages.length > 0 ? (
                  <button className="primary-button" onClick={() => setResultView('evidence')} type="button">Review passage 1 <ArrowRight size={17} /></button>
                ) : (
                  <p><Check size={18} /> No passage-level evidence is available for this result.</p>
                )}
              </div>

              <details className="methodology methodology--compact">
                <summary><span><ScanSearch size={17} /> Method and limitations</span><ChevronRight size={17} /></summary>
                <div className="methodology__content">
                  <div><h3>{analysis.methodology.name}</h3><p>{analysis.methodology.scoreMeaning}</p><p>Profile: {analysis.methodology.profileId}</p></div>
                  <div><h3>Limits</h3><ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
                </div>
              </details>
            </section>
          )}

          {resultView === 'evidence' && (
            <section aria-labelledby="evidence-title" className="evidence-view">
              <div className="compact-heading">
                <div><span className="section-kicker">Passage evidence</span><h2 id="evidence-title">Inspect in context</h2></div>
                <details className="band-help"><summary>Review vs Elevated</summary><p><strong>Review:</strong> {PASSAGE_BANDS.mixed.definition}</p><p><strong>Elevated:</strong> {PASSAGE_BANDS.high.definition}</p></details>
              </div>

              {selectedPassage ? (
                <>
                  <div aria-atomic="true" aria-label="Passage queue" aria-live="polite" className="passage-queue">
                    <button aria-label="Previous passage" disabled={selectedPassageIndex <= 1} onClick={() => movePassage(-1)} type="button"><ChevronLeft size={18} /></button>
                    <div><strong>Passage {selectedPassageIndex} of {analysis.flaggedPassages.length}</strong><span>{selectedPage ? `Page ${selectedPage} · ` : ''}{reviewedPassageIds.size} reviewed</span></div>
                    <button aria-label="Next passage" disabled={selectedPassageIndex >= analysis.flaggedPassages.length} onClick={() => movePassage(1)} type="button"><ChevronRight size={18} /></button>
                    <button aria-pressed={reviewedPassageIds.has(selectedPassage.id)} className={reviewedPassageIds.has(selectedPassage.id) ? 'is-reviewed' : ''} onClick={togglePassageReviewed} type="button"><Check size={16} /> {reviewedPassageIds.has(selectedPassage.id) ? 'Reviewed' : 'Mark reviewed'}</button>
                  </div>

                  <div className="evidence-layout">
                    <article className="document-panel">
                      <div className="document-panel__toolbar"><div><FileText size={17} /><span>{sourceName}</span></div><button className="mobile-evidence-toggle" onClick={() => { evidenceDrawerOpenerRef.current = document.activeElement as HTMLElement; setIsEvidenceDrawerOpen(true) }} ref={evidenceDetailsButtonRef} type="button"><Eye size={16} /> Evidence details</button></div>
                      <HighlightedDocument onSelect={selectPassage} passages={analysis.flaggedPassages} selectedId={selectedPassage.id} text={text} />
                    </article>

                    <aside
                      aria-labelledby="inspector-title"
                      aria-modal={isEvidenceDrawerOpen || undefined}
                      className={`evidence-inspector${isEvidenceDrawerOpen ? ' is-open' : ''}`}
                      ref={evidenceDrawerRef}
                      role={isEvidenceDrawerOpen ? 'dialog' : 'complementary'}
                    >
                      <button aria-label="Close evidence details" className="drawer-close" onClick={closeEvidenceDrawer} ref={evidenceDrawerCloseRef} type="button"><X size={18} /></button>
                      <div className="inspector-heading"><span className={`risk-label risk-label--${selectedPassage.classification}`}>{passageBandLabel(selectedPassage.classification)}</span><strong>{selectedPassage.score}/100 local match</strong></div>
                      <h2 id="inspector-title">What moved this passage</h2>
                      <p className="inspector-note">These signed factors caused the statistical score. They do not prove authorship.</p>
                      <FactorList factors={selectedPassage.modelFactors ?? []} />

                      {selectedPassage.signals.length > 0 && (
                        <details className="observed-details"><summary>Other observed patterns</summary>{selectedPassage.signals.map((signal) => <div key={signal.id}><strong>{signal.label}</strong><p>{signal.description}</p>{signal.evidence[0] ? <q>{signal.evidence[0]}</q> : null}</div>)}</details>
                      )}
                      {relevantCoaching.length > 0 && (
                        <div className="compact-coaching"><h3><Lightbulb size={16} /> Revision prompts</h3>{relevantCoaching.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.action}</p></article>)}</div>
                      )}
                      <button className="secondary-button" onClick={() => void openRevisionLab()} type="button"><Sparkles size={16} /> Revise this document</button>
                    </aside>
                  </div>
                </>
              ) : (
                <div className="empty-evidence"><Check size={23} /><h3>No passage highlights to review</h3><p>{analysis.coverage.status === 'unsupported-domain' ? analysis.domainSupport.reason : 'No qualifying passage crossed the reportable threshold.'}</p></div>
              )}
            </section>
          )}

          {resultView === 'revise' && (
            <section aria-labelledby="revise-title" className="revise-view">
              <div className="compact-heading"><div><span className="section-kicker">Tracked revision</span><h2 id="revise-title">Review every change</h2></div><p>Nothing is applied until you approve it.</p></div>

              {selectedPassage && (
                <details className="contextual-editor">
                  <summary><Sparkles size={17} /><span><strong>Optional contextual edit</strong><small>Clarify, shorten, or strengthen one selected passage.</small></span></summary>
                  <div>
                    <label className="context-opt-in"><input checked={contextualOptIn} onChange={(event) => setContextualOptIn(event.target.checked)} type="checkbox" /><span><strong>Allow this passage to be sent for editing</strong><small>Only passage {selectedPassageIndex} is relayed through Vercel to OpenAI after you click Generate. The request disables reusable response storage, but provider abuse-monitoring retention may still apply. It never asks the model to evade a detector.</small></span></label>
                    {contextualOptIn && (
                      <div className="context-controls">
                        <label>Goal<select onChange={(event) => setContextualIntent(event.target.value as ContextualRevisionIntent)} value={contextualIntent}><option value="clarify">Clarify</option><option value="shorten">Shorten</option><option value="strengthen-reasoning">Strengthen reasoning</option></select></label>
                        <button className="secondary-button" disabled={providerStatus !== 'available' || isContextualLoading} onClick={() => void requestFocusedRevision()} type="button">{isContextualLoading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Generate suggestion</button>
                      </div>
                    )}
                    {providerStatus === 'checking' && <p className="provider-note" role="status">Checking provider…</p>}
                    {providerStatus === 'unavailable' && <p className="provider-note provider-note--unavailable" role="status">Optional provider is not configured. Local tracked edits remain available.</p>}
                    {contextualError && <p className="provider-note provider-note--unavailable" role="alert">{contextualError}</p>}
                    {contextualResult && (
                      <div className="context-result" role="status"><span>Suggested wording</span><p>{contextualResult.revisedText}</p><small>{contextualResult.summary}</small><button className="primary-button" onClick={stageContextualRevision} type="button">Stage as tracked edit</button></div>
                    )}
                  </div>
                </details>
              )}

              {revisionPlan ? (
                <article className="revision-document-panel">
                  <RevisionLab
                    currentAnalysis={analysis}
                    mode={revisionMode}
                    onApply={applyRevisionDraft}
                    onChange={changeRevisionDraft}
                    onModeChange={(mode) => void changeRevisionMode(mode)}
                    onPreview={() => void previewRevisionDraft()}
                    plan={revisionPlan}
                    previewAnalysis={revisionPreview?.sourceText === text && revisionPreview.draftText === revisionDraft ? revisionPreview.analysis : null}
                    value={revisionDraft}
                  />
                </article>
              ) : (
                <div className="empty-evidence"><FileText size={23} /><h3>No revision workspace is available</h3><p>{analysis.flaggedPassages.length === 0 ? 'This audit has no reportable passage to revise.' : 'Return to Evidence and choose a passage.'}</p></div>
              )}
            </section>
          )}
        </main>
      )}

      <footer className="site-footer site-footer--simple">
        <span>DraftLens</span>
        <p>Independent writing-pattern estimate. Not affiliated with Turnitin.</p>
      </footer>
    </div>
  )
}

export default App
