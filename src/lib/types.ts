export type Classification = 'low' | 'mixed' | 'high'

export type ConfidenceLevel = 'low' | 'medium' | 'high'

export type ScoreStatus =
  | 'exact'
  | 'below-reporting-threshold'
  | 'insufficient-prose'
  | 'out-of-range'
  | 'unsupported-domain'

export type DomainSupportStatus =
  | 'supported'
  | 'unsupported'
  | 'not-assessed'

export interface ModelFactor {
  source: 'calibrated-model'
  feature: string
  label: string
  value: number
  standardizedValue: number
  /** Signed contribution to the logistic model's log-odds. */
  contribution: number
  direction: 'raises' | 'lowers' | 'neutral'
}

export interface WritingCharacteristic {
  source: 'writing-characteristic'
  id: string
  label: string
  value: number
  displayValue: string
  description: string
}

export interface AnalysisDomainSupport {
  status: DomainSupportStatus
  label: string
  reason: string
  lexicalContributionShare: number
}

export type ExclusionReason =
  | 'non-prose'
  | 'bibliography'
  | 'unsupported-language'

export type SignalId =
  | 'stock-phrases'
  | 'repetitive-openings'
  | 'uniform-sentence-length'
  | 'repeated-transitions'
  | 'abstract-language'
  | 'nominalized-language'
  | 'low-specificity'
  | 'statistical-pattern'

export interface WritingSignal {
  id: SignalId
  label: string
  description: string
  /** Points this occurrence contributes to the sentence's 0-100 score. */
  impact: number
  /** Exact words or a plain-language measurement that triggered the signal. */
  evidence: string[]
}

export interface SentenceAnalysis {
  id: string
  index: number
  text: string
  /** UTF-16 offset of the first sentence character in the submitted text. */
  start: number
  /** Exclusive UTF-16 offset immediately after the sentence. */
  end: number
  wordCount: number
  /** Whether this sentence contributes to the long-form-prose denominator. */
  qualifies: boolean
  exclusionReason?: ExclusionReason
  /** Local statistical estimate from overlapping passage windows. */
  likelihood: number
  /** Whether the local estimate crossed the calibrated detection threshold. */
  detected: boolean
  /** Explainable style-pattern intensity, retained as a secondary diagnostic. */
  patternScore: number
  score: number
  classification: Classification
  signals: WritingSignal[]
  /** Signed logistic terms averaged across this sentence's local windows. */
  modelFactors?: ModelFactor[]
}

export interface TopSignal {
  id: SignalId
  label: string
  description: string
  affectedSentenceCount: number
  occurrenceCount: number
  totalImpact: number
  evidence: string[]
}

export interface FlaggedPassage {
  id: string
  start: number
  end: number
  text: string
  /** Word-weighted local statistical estimate for this detected passage. */
  score: number
  classification: Exclude<Classification, 'low'>
  sentenceIds: string[]
  signals: TopSignal[]
  /** Strongest signed model terms for this passage. */
  modelFactors?: ModelFactor[]
}

export interface AnalysisConfidence {
  level: ConfidenceLevel
  score: number
  label: string
  reason: string
}

export interface AnalysisStats {
  characterCount: number
  wordCount: number
  qualifyingWordCount: number
  excludedWordCount: number
  detectedWordCount: number
  sentenceCount: number
  qualifyingSentenceCount: number
  detectedSentenceCount: number
  paragraphCount: number
  averageSentenceLength: number
  /** Coefficient of variation, expressed as a 0-100 percentage. */
  sentenceLengthVariation: number
  flaggedSentenceCount: number
  flaggedPassageCount: number
  /** Case-insensitive unique-word share, expressed as a 0-100 percentage. */
  uniqueWordRatio: number
}

export interface CoverageResult {
  /** Raw detected-word coverage, even when product policy suppresses display. */
  rawPercent: number
  /** Null when the exact result should not be shown. */
  displayedPercent: number | null
  displayLabel: string
  status: ScoreStatus
  qualifyingWordCount: number
  detectedWordCount: number
  excludedWordCount: number
  qualifyingSentenceCount: number
  detectedSentenceCount: number
}

export interface RevisionCoaching {
  id: string
  priority: 'high' | 'medium' | 'low'
  title: string
  rationale: string
  action: string
  example?: string
  relatedSignalIds: SignalId[]
}

export interface AnalysisMethodology {
  name: string
  version: string
  kind:
    | 'deterministic-writing-pattern-heuristic'
    | 'calibrated-writing-pattern-estimator'
  description: string
  scoreMeaning: string
  thresholds: Record<Classification, string>
  heuristics: string[]
  profileId?: string
}

export interface AnalysisResult {
  /** Detected qualifying-prose word coverage, not a probability of authorship. */
  score: number
  coverage: CoverageResult
  /** Mean explainable style-pattern intensity over qualifying prose. */
  patternIntensity: number
  /** Signed logistic terms; these explain model behavior, not authorship. */
  modelFactors: ModelFactor[]
  /** Observable document properties kept separate from model evidence. */
  writingCharacteristics: WritingCharacteristic[]
  domainSupport: AnalysisDomainSupport
  classification: Classification
  confidence: AnalysisConfidence
  summary: string
  sentences: SentenceAnalysis[]
  flaggedPassages: FlaggedPassage[]
  topSignals: TopSignal[]
  stats: AnalysisStats
  coaching: RevisionCoaching[]
  methodology: AnalysisMethodology
  limitations: string[]
}
