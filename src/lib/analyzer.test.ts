import { describe, expect, it } from 'vitest'

import { analyzeText } from './analyzer'

const formulaicText = [
  'Moreover, the implementation of a comprehensive framework facilitates the optimization of important processes.',
  'Moreover, the implementation of a comprehensive framework facilitates the optimization of important outcomes.',
  'Furthermore, it is important to note that this holistic approach plays a crucial role in transformation.',
  'In conclusion, it is evident that a robust framework underscores the importance of innovation.',
].join(' ')

const concreteText = [
  'At 6:15 on 14 March, Priya Nair counted 23 crates beside Dock 4.',
  'Two were wet.',
  "I opened the damaged crate with supervisor Luis Ortega and photographed a split seal under the blue plastic strap; the pears inside smelled sour, while the labels showed yesterday's packing date.",
  'We moved those two crates to the cold room, called Northline Logistics, and recorded batch C17 in the warehouse log before noon.',
].join(' ')

const longFormulaicText = Array(7).fill(formulaicText).join(' ')
const longConcreteText = Array(5).fill(concreteText).join(' ')

describe('analyzeText', () => {
  it('is deterministic and keeps every numeric score within 0-100', () => {
    const inputs = ['', 'A short sentence.', longConcreteText, longFormulaicText]

    inputs.forEach((input) => {
      const first = analyzeText(input)
      const second = analyzeText(input)

      expect(first).toEqual(second)
      expect(first.score).toBeGreaterThanOrEqual(0)
      expect(first.score).toBeLessThanOrEqual(100)
      expect(first.patternIntensity).toBeGreaterThanOrEqual(0)
      expect(first.patternIntensity).toBeLessThanOrEqual(100)
      expect(first.confidence.score).toBeGreaterThanOrEqual(0)
      expect(first.confidence.score).toBeLessThanOrEqual(100)
      first.sentences.forEach((sentence) => {
        expect(sentence.score).toBeGreaterThanOrEqual(0)
        expect(sentence.score).toBeLessThanOrEqual(100)
        expect(sentence.likelihood).toBeGreaterThanOrEqual(0)
        expect(sentence.likelihood).toBeLessThanOrEqual(100)
      })
    })
  })

  it('reports detected qualifying-word coverage rather than mean intensity', () => {
    const result = analyzeText(longFormulaicText)
    const expected = Math.round(
      (result.coverage.detectedWordCount /
        result.coverage.qualifyingWordCount) *
        100,
    )

    expect(result.score).toBe(expected)
    expect(result.score).toBe(result.coverage.rawPercent)
    expect(result.coverage.status).toBe('exact')
    expect(result.coverage.displayedPercent).toBe(result.score)
  })

  it('separates concrete reporting from formulaic stock prose', () => {
    const concrete = analyzeText(longConcreteText)
    const formulaic = analyzeText(longFormulaicText)

    expect(concrete.score).toBeLessThan(formulaic.score)
    expect(formulaic.score - concrete.score).toBeGreaterThanOrEqual(50)
    expect(concrete.patternIntensity).toBeLessThan(formulaic.patternIntensity)
    expect(formulaic.topSignals.map((signal) => signal.id)).toContain(
      'statistical-pattern',
    )
    expect(formulaic.topSignals.map((signal) => signal.id)).toContain(
      'stock-phrases',
    )
  })

  it('returns exact, end-exclusive offsets into the original input', () => {
    const input =
      '  First sentence.\n\nSecond sentence includes an abbreviation, e.g. a short example!  Last line has no punctuation  '
    const result = analyzeText(input)

    expect(result.sentences.map((sentence) => sentence.text)).toEqual([
      'First sentence.',
      'Second sentence includes an abbreviation, e.g. a short example!',
      'Last line has no punctuation',
    ])
    result.sentences.forEach((sentence) => {
      expect(input.slice(sentence.start, sentence.end)).toBe(sentence.text)
    })
    expect(result.sentences[0].start).toBe(2)
    expect(result.sentences.at(-1)?.end).toBe(input.length - 2)
  })

  it('treats a terminal abbreviation before a capital as a sentence end', () => {
    const result = analyzeText(
      'The packing list included tape, labels, etc. "The backup list also ended with etc." Next, Maya counted 18 red folders.',
    )

    expect(result.sentences.map((sentence) => sentence.text)).toEqual([
      'The packing list included tape, labels, etc.',
      '"The backup list also ended with etc."',
      'Next, Maya counted 18 red folders.',
    ])
  })

  it('requires at least 300 qualifying words for a reportable result', () => {
    const short = analyzeText('Brief note.')
    const long = analyzeText(longConcreteText)

    expect(short.confidence.level).toBe('low')
    expect(short.coverage.status).toBe('insufficient-prose')
    expect(short.coverage.displayedPercent).toBeNull()
    expect(short.confidence.reason).toContain('2 qualifying words')
    expect(long.coverage.qualifyingWordCount).toBeGreaterThanOrEqual(300)
    expect(long.coverage.status).toBe('exact')
  })

  it('applies the 300 and 30,000 qualifying-word boundaries', () => {
    const words = (count: number) => `${Array(count).fill('word').join(' ')}.`

    expect(analyzeText(words(299)).coverage.status).toBe('insufficient-prose')
    expect(analyzeText(words(300)).coverage.status).toBe('exact')
    expect(analyzeText(words(30_001)).coverage.status).toBe('out-of-range')
  })

  it('excludes headings, page numbers, lists, unsupported prose, and references', () => {
    const input = [
      'FIELD OBSERVATION REPORT',
      '',
      'Page 1',
      '',
      '- inventory label only',
      '',
      concreteText,
      '',
      'La educación es una parte de la sociedad y para los estudiantes es importante que la escuela tenga recursos para el aprendizaje.',
      '',
      'References',
      '',
      '1. Example, A. (2024). A reference entry that should not enter the qualifying denominator.',
    ].join('\n')
    const result = analyzeText(input)

    expect(result.sentences.some((sentence) => sentence.qualifies)).toBe(true)
    expect(
      result.sentences.find((sentence) => sentence.text === 'Two were wet.')
        ?.qualifies,
    ).toBe(true)
    expect(
      result.sentences.some(
        (sentence) => sentence.exclusionReason === 'unsupported-language',
      ),
    ).toBe(true)
    expect(
      result.sentences.some(
        (sentence) => sentence.exclusionReason === 'bibliography',
      ),
    ).toBe(true)
    result.flaggedPassages.forEach((passage) => {
      const passageSentences = result.sentences.filter((sentence) =>
        passage.sentenceIds.includes(sentence.id),
      )
      expect(passageSentences.every((sentence) => sentence.qualifies)).toBe(true)
    })
  })

  it('does not let an appended bibliography change the score denominator', () => {
    const references = Array(80)
      .fill(
        'Example, A. (2024). A long reference title with publication details and a journal name.',
      )
      .join('\n')
    const base = analyzeText(longFormulaicText)
    const withReferences = analyzeText(
      `${longFormulaicText}\n\nReferences\n\n${references}`,
    )

    expect(withReferences.score).toBe(base.score)
    expect(withReferences.coverage.qualifyingWordCount).toBe(
      base.coverage.qualifyingWordCount,
    )
    expect(withReferences.coverage.excludedWordCount).toBeGreaterThan(
      base.coverage.excludedWordCount,
    )
  })

  it('returns reportable passage highlights only at or above 20%', () => {
    const result = analyzeText(longFormulaicText)

    expect(result.score).toBeGreaterThanOrEqual(20)
    expect(result.flaggedPassages.length).toBeGreaterThan(0)
    result.flaggedPassages.forEach((passage) => {
      expect(passage.sentenceIds.length).toBeLessThanOrEqual(8)
      expect(result.sentences.every((sentence) =>
        passage.sentenceIds.includes(sentence.id)
          ? sentence.qualifies && sentence.detected
          : true,
      )).toBe(true)
      expect(longFormulaicText.slice(passage.start, passage.end)).toBe(
        passage.text,
      )
    })
  })

  it('separates detected passages into Review and Elevated local bands', () => {
    const result = analyzeText(
      [formulaicText, formulaicText, ...Array(3).fill(concreteText)].join(' '),
    )

    expect(result.coverage.status).toBe('exact')
    expect(result.score).toBeGreaterThanOrEqual(20)
    expect(result.flaggedPassages[0]?.score).toBeGreaterThanOrEqual(95)
    expect(result.flaggedPassages[1]?.score).toBeLessThan(95)
    expect(
      result.flaggedPassages.map((passage) => passage.classification),
    ).toEqual(['high', 'mixed'])
  })

  it('suppresses exact 1-19% results and their highlights', () => {
    const mixed = analyzeText(
      [formulaicText, ...Array(4).fill(concreteText)].join(' '),
    )

    expect(mixed.coverage.qualifyingWordCount).toBeGreaterThanOrEqual(300)
    expect(mixed.score).toBeGreaterThan(0)
    expect(mixed.score).toBeLessThan(20)
    expect(mixed.coverage.status).toBe('below-reporting-threshold')
    expect(mixed.coverage.displayedPercent).toBeNull()
    expect(mixed.coverage.displayLabel).toBe('*%')
    expect(mixed.flaggedPassages).toHaveLength(0)
  })

  it('states the calibrated method, profile, and authorship limitations', () => {
    const result = analyzeText(longFormulaicText)

    expect(result.methodology.kind).toBe(
      'calibrated-writing-pattern-estimator',
    )
    expect(result.methodology.profileId).toBe(
      'ghostbuster-essay-logistic@ghostbuster-essay-v2',
    )
    expect(result.methodology.scoreMeaning).toMatch(/qualifying prose/i)
    expect(result.methodology.scoreMeaning).toMatch(/not the probability/i)
    expect(result.limitations.join(' ')).toMatch(/not Turnitin/i)
    expect(result.limitations.join(' ')).toMatch(/cannot establish authorship/i)
    expect(result.coaching.length).toBeGreaterThan(0)
  })
})
