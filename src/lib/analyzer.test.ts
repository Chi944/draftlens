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

const formalAcademicFixtures = [
  Array(4)
    .fill(
      [
        'Spectrophotometric quantification demonstrated substantial intracellular phosphorylation after thermodynamic stabilization of the recombinant microorganism culture (Ramanathan et al., 2021).',
        'Chromatographic characterization separated the polyunsaturated metabolites before immunohistochemical examination of mitochondrial membranes.',
        'The experimental methodology incorporated triplicate measurements, temperature-controlled centrifugation, and preregistered exclusion criteria for contaminated observations.',
        'Researchers documented concentration-dependent differentiation across the longitudinal intervention groups without substituting unverified interpretations for recorded measurements.',
        'Heteroscedasticity diagnostics supported logarithmic transformation before multivariable regression, although confidence intervals remained comparatively wide.',
        'Independent replication identified comparable electrophysiological associations in geographically separated populations (Mendelson and Ibarra, 2020).',
        'These observations constrain generalization because institutional recruitment excluded participants with cardiometabolic contraindications.',
      ].join(' '),
    )
    .join(' '),
  Array(4)
    .fill(
      [
        'Environmental sustainability disclosures documented organizational decarbonization commitments across multinational manufacturing corporations (Wijayanto et al., 2023).',
        'The longitudinal investigation compared independently verified greenhouse-gas inventories with contemporaneous profitability measurements.',
        'Corporate-governance characteristics included board independence, institutional ownership concentration, remuneration transparency, and stakeholder consultation frequency.',
        'Multivariate specifications incorporated industry classification, capitalization, internationalization, and macroeconomic volatility as prespecified covariates.',
        'Researchers interpreted statistically insignificant associations conservatively because inconsistent disclosure frameworks limited comparability between jurisdictions.',
        'Sensitivity analyses reproduced the directional relationship after excluding financial institutions and winsorizing exceptionally capitalized observations.',
        'Consequently, the literature supports conditional association rather than universal causation between sustainability governance and enterprise valuation.',
      ].join(' '),
    )
    .join(' '),
]

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

  it('withholds saturated formal-academic extrapolations outside calibration support', () => {
    formalAcademicFixtures.forEach((fixture) => {
      const result = analyzeText(fixture)

      expect(result.coverage.qualifyingWordCount).toBeGreaterThanOrEqual(300)
      expect(result.coverage.rawPercent).toBeGreaterThanOrEqual(80)
      expect(result.domainSupport.status).toBe('unsupported')
      expect(result.coverage.status).toBe('unsupported-domain')
      expect(result.coverage.displayedPercent).toBeNull()
      expect(result.coverage.displayLabel).toBe('Outside calibrated domain')
      expect(result.flaggedPassages).toHaveLength(0)
      expect(result.summary).not.toMatch(/\b(?:8\d|9\d|100)%\b/u)
      expect(result.writingCharacteristics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'writing-characteristic',
            id: 'long-word-ratio',
          }),
        ]),
      )
      expect(result.modelFactors[0]).toEqual(
        expect.objectContaining({
          source: 'calibrated-model',
          feature: 'meanWordLength',
          direction: 'raises',
        }),
      )
    })
  })

  it('attaches causal signed model factors to detected passages', () => {
    const result = analyzeText(longFormulaicText)
    const passage = result.flaggedPassages[0]

    expect(result.domainSupport.status).toBe('supported')
    expect(passage?.modelFactors?.length).toBeGreaterThan(1)
    expect(
      passage?.modelFactors?.some((factor) => factor.contribution > 0),
    ).toBe(true)
    expect(
      passage?.modelFactors?.some((factor) => factor.contribution < 0),
    ).toBe(true)
    passage?.modelFactors?.forEach((factor) => {
      expect(factor.source).toBe('calibrated-model')
      expect(Number.isFinite(factor.value)).toBe(true)
      expect(Number.isFinite(factor.standardizedValue)).toBe(true)
      expect(Number.isFinite(factor.contribution)).toBe(true)
    })
  })

  it('does not merge a detected passage across paragraph or PDF-page boundaries', () => {
    const paragraph = Array(5).fill(formulaicText).join(' ')
    const result = analyzeText(`${paragraph}\n\n${paragraph}`)

    expect(result.coverage.status).toBe('exact')
    expect(result.flaggedPassages.length).toBeGreaterThanOrEqual(2)
    expect(
      result.flaggedPassages.every((passage) => !passage.text.includes('\n\n')),
    ).toBe(true)
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

  it('uses excluded physical lines as hard barriers around qualifying prose', () => {
    const firstBodySentence =
      'Moreover, the implementation of a comprehensive framework facilitates the optimization of important processes.'
    const input = [
      'CHAPTER I',
      'INTRODUCTION',
      '1.1 Background',
      longFormulaicText,
    ].join('\n')
    const result = analyzeText(input)
    const firstQualifying = result.sentences.find((sentence) => sentence.qualifies)

    expect(firstQualifying?.start).toBe(input.indexOf(firstBodySentence))
    result.sentences.forEach((sentence) => {
      expect(input.slice(sentence.start, sentence.end)).toBe(sentence.text)
    })
    expect(
      result.sentences
        .filter((sentence) => sentence.qualifies)
        .some((sentence) => /CHAPTER|INTRODUCTION|1\.1 Background/u.test(sentence.text)),
    ).toBe(false)
  })

  it('keeps contents, document headings, keywords, footers, and page numbers out of evidence', () => {
    const baseText = `${longFormulaicText}\n${longFormulaicText}`
    const decoratedText = [
      'TABLE OF CONTENTS',
      'COVER................................ i',
      'CHAPTER I - INTRODUCTION............. 1',
      'LIST OF TABLES',
      'Table 2.1 Journal Review............. 20',
      'CHAPTER I',
      'INTRODUCTION',
      '1.1 Background',
      'Keywords: sustainability, governance, reporting',
      longFormulaicText,
      '1',
      'Universitas Indonesia',
      'CHAPTER II',
      'DISCUSSION',
      longFormulaicText,
      'ii',
      'Universitas Indonesia',
    ].join('\n')
    const base = analyzeText(baseText)
    const decorated = analyzeText(decoratedText)
    const artifactPattern =
      /TABLE OF CONTENTS|\.{3,}|CHAPTER|INTRODUCTION|LIST OF TABLES|Keywords:|Universitas Indonesia/iu

    expect(decorated.coverage.qualifyingWordCount).toBe(
      base.coverage.qualifyingWordCount,
    )
    expect(decorated.score).toBe(base.score)
    expect(
      decorated.sentences
        .filter((sentence) => sentence.qualifies)
        .some((sentence) => artifactPattern.test(sentence.text)),
    ).toBe(false)
    expect(
      decorated.flaggedPassages.some((passage) =>
        artifactPattern.test(passage.text),
      ),
    ).toBe(false)
  })

  it('does not mistake a prose line beginning with references for a bibliography heading', () => {
    const input = [
      longFormulaicText,
      'This section summarizes the ten selected journal articles used as the primary',
      'references in this study.',
      'The selected articles were analyzed against the stated research questions.',
      longFormulaicText,
    ].join('\n')
    const result = analyzeText(input)
    const discussion = result.sentences.find((sentence) =>
      sentence.text.includes('references in this study'),
    )

    expect(discussion?.qualifies).toBe(true)
    expect(discussion?.exclusionReason).toBeUndefined()
    expect(
      result.sentences
        .filter((sentence) =>
          sentence.text.includes('selected articles were analyzed'),
        )
        .every((sentence) => sentence.qualifies),
    ).toBe(true)
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
      'ghostbuster-essay-logistic@ghostbuster-essay-v3-domain-gated',
    )
    expect(result.methodology.scoreMeaning).toMatch(/qualifying prose/i)
    expect(result.methodology.scoreMeaning).toMatch(/not the probability/i)
    expect(result.limitations.join(' ')).toMatch(/not Turnitin/i)
    expect(result.limitations.join(' ')).toMatch(/cannot establish authorship/i)
    expect(result.coaching.length).toBeGreaterThan(0)
  })
})
