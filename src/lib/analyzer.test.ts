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
  'I opened the damaged crate with supervisor Luis Ortega and photographed a split seal under the blue plastic strap; the pears inside smelled sour, while the labels showed yesterday’s packing date.',
  'We moved those two crates to the cold room, called Northline Logistics, and recorded batch C17 in the warehouse log before noon.',
].join(' ')

describe('analyzeText', () => {
  it('is deterministic and keeps every numeric score within 0-100', () => {
    const inputs = ['', 'A short sentence.', concreteText, formulaicText]

    inputs.forEach((input) => {
      const first = analyzeText(input)
      const second = analyzeText(input)

      expect(first).toEqual(second)
      expect(first.score).toBeGreaterThanOrEqual(0)
      expect(first.score).toBeLessThanOrEqual(100)
      expect(first.confidence.score).toBeGreaterThanOrEqual(0)
      expect(first.confidence.score).toBeLessThanOrEqual(100)
      first.sentences.forEach((sentence) => {
        expect(sentence.score).toBeGreaterThanOrEqual(0)
        expect(sentence.score).toBeLessThanOrEqual(100)
      })
      first.flaggedPassages.forEach((passage) => {
        expect(passage.score).toBeGreaterThanOrEqual(0)
        expect(passage.score).toBeLessThanOrEqual(100)
      })
    })
  })

  it('scores concrete, varied reporting below formulaic stock prose', () => {
    const concrete = analyzeText(concreteText)
    const formulaic = analyzeText(formulaicText)

    expect(concrete.score).toBeLessThan(formulaic.score)
    expect(formulaic.score - concrete.score).toBeGreaterThanOrEqual(30)
    expect(formulaic.topSignals.map((signal) => signal.id)).toContain(
      'stock-phrases',
    )
    expect(formulaic.topSignals.map((signal) => signal.id)).toContain(
      'abstract-language',
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
      'The packing list included tape, labels, etc. “The backup list also ended with etc.” Next, Maya counted 18 red folders.',
    )

    expect(result.sentences.map((sentence) => sentence.text)).toEqual([
      'The packing list included tape, labels, etc.',
      '“The backup list also ended with etc.”',
      'Next, Maya counted 18 red folders.',
    ])
  })

  it('marks a short input as low confidence and explains the limitation', () => {
    const result = analyzeText('Brief note.')

    expect(result.confidence.level).toBe('low')
    expect(result.confidence.label).toBe('Low confidence')
    expect(result.confidence.reason).toContain('2 words')
    expect(result.limitations.join(' ')).toMatch(/Short samples/i)
  })

  it('groups adjacent mixed/high sentences and splits groups at low sentences', () => {
    const input = [
      'It is important to note that a holistic approach plays a crucial role in progress.',
      'Furthermore, the implementation of comprehensive solutions supports optimization and improvement.',
      'Furthermore, the implementation of robust frameworks supports optimization and improvement.',
      'Maya counted 18 red folders on desk 7.',
      'In conclusion, it is evident that a holistic approach plays a crucial role in transformation.',
    ].join(' ')
    const result = analyzeText(input)

    expect(result.sentences.map((sentence) => sentence.classification)).toEqual([
      'high',
      'high',
      'high',
      'low',
      'high',
    ])
    expect(result.flaggedPassages).toHaveLength(2)
    expect(result.flaggedPassages[0].sentenceIds).toEqual([
      'sentence-1',
      'sentence-2',
      'sentence-3',
    ])
    expect(result.flaggedPassages[1].sentenceIds).toEqual(['sentence-5'])
    result.flaggedPassages.forEach((passage) => {
      expect(input.slice(passage.start, passage.end)).toBe(passage.text)
    })
  })

  it('states the method and authorship limitations in the returned result', () => {
    const result = analyzeText(formulaicText)

    expect(result.methodology.kind).toBe(
      'deterministic-writing-pattern-heuristic',
    )
    expect(result.methodology.scoreMeaning).toMatch(/not a probability/i)
    expect(result.limitations.join(' ')).toMatch(/not Turnitin/i)
    expect(result.limitations.join(' ')).toMatch(/cannot establish authorship/i)
    expect(result.coaching.length).toBeGreaterThan(0)
    expect(result.coaching[0].action.length).toBeGreaterThan(20)
  })
})
