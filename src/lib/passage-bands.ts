import type { Classification } from './types'

export const ELEVATED_PASSAGE_SCORE_THRESHOLD = 95
export type PassageBand = Exclude<Classification, 'low'>

export const PASSAGE_BANDS = {
  mixed: {
    label: 'Review',
    definition: `Crossed the calibrated detection threshold, with a weighted local estimate below ${ELEVATED_PASSAGE_SCORE_THRESHOLD}/100.`,
  },
  high: {
    label: 'Elevated',
    definition: `A stronger local match, with a weighted local estimate of ${ELEVATED_PASSAGE_SCORE_THRESHOLD}/100 or higher.`,
  },
} as const

export function classifyDetectedPassageScore(
  score: number,
  detected: true,
): PassageBand
export function classifyDetectedPassageScore(
  score: number,
  detected: boolean,
): Classification
export function classifyDetectedPassageScore(
  score: number,
  detected: boolean,
): Classification {
  if (!detected) return 'low'
  return score >= ELEVATED_PASSAGE_SCORE_THRESHOLD ? 'high' : 'mixed'
}

export function passageBandLabel(
  classification: PassageBand,
): string {
  return PASSAGE_BANDS[classification].label
}
