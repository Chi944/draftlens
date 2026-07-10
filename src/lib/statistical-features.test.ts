import { describe, expect, it } from 'vitest'

import {
  CALIBRATION_PROFILE,
  STATISTICAL_FEATURE_NAMES,
  createStatisticalWindowRanges,
  createStatisticalWindows,
  extractStatisticalFeatures,
  scoreStatisticalWindow,
} from './statistical-features'

const concreteReporting = [
  'At 6:15 on 14 March, Priya Nair counted 23 crates beside Dock 4.',
  'Two were wet, so she marked their labels with blue chalk.',
  'I opened crate C17 with supervisor Luis Ortega and photographed the split seal under its plastic strap.',
  'The pears smelled sour, although the packing slip showed that Northline had loaded them only nine hours earlier.',
  'We moved both crates into the 3-degree cold room and called the driver before noon.',
  'Luis signed page 8 of the warehouse log; I attached four photographs and the scale receipt.',
  'On Friday, the supplier credited $184.20 to invoice 771 and collected the damaged fruit.',
].join(' ')

const formulaicProse = [
  'Moreover, the implementation of a comprehensive framework facilitates the optimization of important processes.',
  'Furthermore, the implementation of a comprehensive framework facilitates the optimization of important outcomes.',
  'It is important to note that this multifaceted approach plays a crucial role in meaningful transformation.',
  'Additionally, a wide range of robust strategies underscores the importance of sustainable innovation.',
  'Therefore, organizations can delve into holistic solutions that enhance efficiency and foster continuous improvement.',
  'In conclusion, it is evident that this comprehensive framework plays a significant role in long-term success.',
].join(' ')

describe('statistical calibration', () => {
  it('extracts one finite value for every calibrated feature', () => {
    const features = extractStatisticalFeatures(concreteReporting)

    expect(Object.keys(features)).toEqual([...STATISTICAL_FEATURE_NAMES])
    Object.values(features).forEach((value) => {
      expect(Number.isFinite(value)).toBe(true)
    })
    expect(Object.values(extractStatisticalFeatures(''))).toEqual(
      Array(STATISTICAL_FEATURE_NAMES.length).fill(0),
    )
  })

  it('is deterministic, bounded, and separates the frozen reference styles', () => {
    const concreteScore = scoreStatisticalWindow(concreteReporting)
    const formulaicScore = scoreStatisticalWindow(formulaicProse)

    expect(scoreStatisticalWindow(concreteReporting)).toBe(concreteScore)
    expect(concreteScore).toBeGreaterThanOrEqual(0)
    expect(formulaicScore).toBeLessThanOrEqual(1)
    expect(concreteScore).toBeLessThan(CALIBRATION_PROFILE.detectionThreshold)
    expect(formulaicScore).toBeGreaterThan(
      CALIBRATION_PROFILE.detectionThreshold,
    )
  })

  it('creates only the 5-7 sentence windows used during training', () => {
    const sentences = Array.from(
      { length: 12 },
      (_, index) => `Sentence ${index + 1} records a distinct observation.`,
    ).join(' ')
    const windows = createStatisticalWindows(sentences)

    expect(windows).toHaveLength(3)
    windows.forEach((window) => {
      const sentenceCount = window.match(/\./g)?.length ?? 0
      expect(sentenceCount).toBeGreaterThanOrEqual(5)
      expect(sentenceCount).toBeLessThanOrEqual(7)
    })
    expect(createStatisticalWindows('Only one sentence.')).toEqual([])
    expect(createStatisticalWindowRanges(12)).toEqual([
      { start: 0, end: 7 },
      { start: 3, end: 10 },
      { start: 5, end: 12 },
    ])
  })

  it('records conservative untouched-test metrics and corpus attribution', () => {
    expect(CALIBRATION_PROFILE.source.license).toBe('CC BY 3.0')
    expect(
      CALIBRATION_PROFILE.validation.testHumanDocumentFalsePositiveRate,
    ).toBeLessThan(0.01)
    expect(CALIBRATION_PROFILE.validation.testAiDocumentRecall).toBeGreaterThan(
      0.64,
    )
    expect(CALIBRATION_PROFILE.validation.testWindowRocAuc).toBeGreaterThan(0.9)
  })
})
