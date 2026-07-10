import type { AnalysisResult } from './types'

export type RevisionPreviewAnalysis = Pick<
  AnalysisResult,
  'score' | 'coverage' | 'patternIntensity' | 'flaggedPassages' | 'stats'
>

export type RevisionComparisonDirection =
  | 'decreased'
  | 'unchanged'
  | 'increased'
  | 'unavailable'

export interface RevisionAuditComparison {
  direction: RevisionComparisonDirection
  coverageDelta: number | null
  patternIntensityDelta: number
  headline: string
  detail: string
}

export function compareRevisionAudits(
  current: RevisionPreviewAnalysis,
  draft: RevisionPreviewAnalysis,
): RevisionAuditComparison {
  const patternIntensityDelta =
    draft.patternIntensity - current.patternIntensity

  if (
    current.coverage.status === 'exact' &&
    draft.coverage.status === 'below-reporting-threshold'
  ) {
    return {
      direction: 'decreased',
      coverageDelta: null,
      patternIntensityDelta,
      headline: 'The draft fell below the reporting threshold.',
      detail:
        'The exact draft result remains suppressed under the same low-coverage policy. This local result does not predict another detector.',
    }
  }

  if (
    current.coverage.status !== 'exact' ||
    draft.coverage.status !== 'exact'
  ) {
    return {
      direction: 'unavailable',
      coverageDelta: null,
      patternIntensityDelta,
      headline: 'A numeric coverage comparison is unavailable.',
      detail:
        'The draft is outside a directly comparable reporting state. Review the writing and document length before applying it.',
    }
  }

  const coverageDelta = draft.score - current.score
  if (coverageDelta < 0) {
    return {
      direction: 'decreased',
      coverageDelta,
      patternIntensityDelta,
      headline: `Local coverage decreased by ${Math.abs(coverageDelta)} ${Math.abs(coverageDelta) === 1 ? 'point' : 'points'}.`,
      detail:
        'One or more overlapping passage windows moved in this local audit. Clarity edits are not guaranteed to lower this estimate or any third-party result.',
    }
  }

  if (coverageDelta > 0) {
    return {
      direction: 'increased',
      coverageDelta,
      patternIntensityDelta,
      headline: `Local coverage increased by ${coverageDelta} ${coverageDelta === 1 ? 'point' : 'points'}.`,
      detail:
        'Rewording can move overlapping passage windows in either direction. Review whether the draft is clearer and more accurate before applying it.',
    }
  }

  const intensityMessage =
    patternIntensityDelta < 0
      ? ` Pattern intensity decreased by ${Math.abs(patternIntensityDelta)} ${Math.abs(patternIntensityDelta) === 1 ? 'point' : 'points'}.`
      : patternIntensityDelta > 0
        ? ` Pattern intensity increased by ${patternIntensityDelta} ${patternIntensityDelta === 1 ? 'point' : 'points'}.`
        : ''

  return {
    direction: 'unchanged',
    coverageDelta: 0,
    patternIntensityDelta,
    headline: 'Local coverage is unchanged.',
    detail: `The edits did not move enough qualifying prose across the overlapping-window threshold.${intensityMessage} Judge the draft by clarity and accuracy, not this score alone.`,
  }
}

