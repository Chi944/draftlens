export type Classification = 'low' | 'mixed' | 'high'

export type ConfidenceLevel = 'low' | 'medium' | 'high'

export type SignalId =
  | 'stock-phrases'
  | 'repetitive-openings'
  | 'uniform-sentence-length'
  | 'repeated-transitions'
  | 'abstract-language'
  | 'nominalized-language'
  | 'low-specificity'

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
  score: number
  classification: Classification
  signals: WritingSignal[]
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
  score: number
  classification: Exclude<Classification, 'low'>
  sentenceIds: string[]
  signals: TopSignal[]
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
  sentenceCount: number
  paragraphCount: number
  averageSentenceLength: number
  /** Coefficient of variation, expressed as a 0-100 percentage. */
  sentenceLengthVariation: number
  flaggedSentenceCount: number
  flaggedPassageCount: number
  /** Case-insensitive unique-word share, expressed as a 0-100 percentage. */
  uniqueWordRatio: number
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
  kind: 'deterministic-writing-pattern-heuristic'
  description: string
  scoreMeaning: string
  thresholds: Record<Classification, string>
  heuristics: string[]
}

export interface AnalysisResult {
  /** A 0-100 heuristic writing-pattern score, not a probability of AI authorship. */
  score: number
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
