import { describe, expect, it } from 'vitest'

import {
  compareRevisionAudits,
  type RevisionPreviewAnalysis,
} from './revision-preview'
import { analyzeText } from './analyzer'
import { planAuditRevisions } from './revision'

function previewAnalysis(
  score: number,
  patternIntensity: number,
  status: RevisionPreviewAnalysis['coverage']['status'] = 'exact',
): RevisionPreviewAnalysis {
  return {
    score,
    patternIntensity,
    coverage: {
      rawPercent: score,
      displayedPercent: status === 'exact' ? score : null,
      displayLabel: status === 'exact' ? `${score}%` : '*%',
      status,
      qualifyingWordCount: 400,
      detectedWordCount: Math.round(score * 4),
      excludedWordCount: 0,
      qualifyingSentenceCount: 24,
      detectedSentenceCount: 12,
    },
    flaggedPassages: [],
    stats: {
      characterCount: 2_000,
      wordCount: 400,
      qualifyingWordCount: 400,
      excludedWordCount: 0,
      detectedWordCount: Math.round(score * 4),
      sentenceCount: 24,
      qualifyingSentenceCount: 24,
      detectedSentenceCount: 12,
      paragraphCount: 6,
      averageSentenceLength: 16.7,
      sentenceLengthVariation: 30,
      flaggedSentenceCount: 12,
      flaggedPassageCount: 2,
      uniqueWordRatio: 60,
    },
  }
}

describe('revision audit comparison', () => {
  it('describes decreased, unchanged, and increased exact coverage', () => {
    expect(
      compareRevisionAudits(
        previewAnalysis(80, 70),
        previewAnalysis(55, 48),
      ),
    ).toMatchObject({ direction: 'decreased', coverageDelta: -25 })

    const unchanged = compareRevisionAudits(
      previewAnalysis(80, 70),
      previewAnalysis(80, 48),
    )
    expect(unchanged).toMatchObject({
      direction: 'unchanged',
      coverageDelta: 0,
      patternIntensityDelta: -22,
    })
    expect(unchanged.detail).toContain('overlapping-window threshold')

    expect(
      compareRevisionAudits(
        previewAnalysis(55, 48),
        previewAnalysis(60, 52),
      ),
    ).toMatchObject({ direction: 'increased', coverageDelta: 5 })
  })

  it('does not expose a suppressed raw percentage', () => {
    const comparison = compareRevisionAudits(
      previewAnalysis(80, 70),
      previewAnalysis(13, 35, 'below-reporting-threshold'),
    )

    expect(comparison.direction).toBe('decreased')
    expect(comparison.coverageDelta).toBeNull()
    expect(`${comparison.headline} ${comparison.detail}`).not.toContain('13')
  })

  it('marks non-comparable document states unavailable', () => {
    const comparison = compareRevisionAudits(
      previewAnalysis(80, 70),
      previewAnalysis(0, 0, 'insufficient-prose'),
    )

    expect(comparison.direction).toBe('unavailable')
    expect(comparison.coverageDelta).toBeNull()
  })

  it('explains a real draft whose intensity falls while coverage stays thresholded', () => {
    const formulaicUnit = [
      'Moreover, the implementation of a comprehensive framework facilitates the optimization of important processes.',
      'Moreover, the implementation of a comprehensive framework facilitates the optimization of important outcomes.',
      'Furthermore, it is important to note that this holistic approach plays a crucial role in transformation.',
      'In conclusion, it is evident that a robust framework underscores the importance of innovation.',
    ].join(' ')
    const sourceText = Array(7).fill(formulaicUnit).join(' ')
    const current = analyzeText(sourceText)
    const plan = planAuditRevisions(sourceText, current, {
      mode: 'comprehensive',
    })
    const draft = analyzeText(plan.previewText)
    const comparison = compareRevisionAudits(current, draft)

    expect(plan.edits.length).toBeGreaterThan(7)
    expect(draft.patternIntensity).toBeLessThan(current.patternIntensity)
    expect(comparison.detail).toMatch(
      /overlapping passage windows|overlapping-window threshold/iu,
    )
  })
})
