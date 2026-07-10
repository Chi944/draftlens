import { CALIBRATION_PROFILE } from '../data/calibration-profile'

export { CALIBRATION_PROFILE } from '../data/calibration-profile'

export const STATISTICAL_FEATURE_NAMES = [
  'meanSentenceWords',
  'sentenceLengthCv',
  'shortSentenceRatio',
  'longSentenceRatio',
  'meanWordLength',
  'repeatedWordRatio',
  'hapaxRatio',
  'stopwordRatio',
  'firstPersonRatio',
  'contractionRatio',
  'numericTokenRatio',
  'commaPerSentence',
  'semicolonColonPerSentence',
  'parentheticalDashPerSentence',
  'transitionOpeningRatio',
  'stockPhrasePerSentence',
  'nominalizationRatio',
  'adjacentSentenceOverlap',
  'repeatedOpenerRatio',
  'properNounRatio',
  'passiveConstructionRatio',
  'hedgeRatio',
] as const

export type StatisticalFeatureName =
  (typeof STATISTICAL_FEATURE_NAMES)[number]

export type StatisticalFeatureVector = Record<StatisticalFeatureName, number>

export interface StatisticalCalibrationProfile {
  id: string
  version: string
  model: 'standardized-logistic-regression'
  featureNames: readonly StatisticalFeatureName[]
  means: StatisticalFeatureVector
  scales: StatisticalFeatureVector
  coefficients: StatisticalFeatureVector
  intercept: number
  detectionThreshold: number
  source: {
    name: string
    url: string
    license: string
    revision: string
  }
  training: {
    windowSentences: string
    split: string
    humanFamily: string
    aiFamilies: readonly string[]
    regularization: number
  }
  validation: {
    trainDocuments: number
    validationDocuments: number
    testDocuments: number
    validationHumanDocumentFalsePositiveRate: number
    validationAiDocumentRecall: number
    testHumanDocumentFalsePositiveRate: number
    testAiDocumentRecall: number
    testWindowRocAuc: number
    testWindowBalancedAccuracy: number
  }
}

const WORD_PATTERN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?|\p{N}+(?:[.,]\p{N}+)*/gu
const COVERAGE_WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'our',
  'she',
  'that',
  'the',
  'their',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'which',
  'with',
  'you',
])

const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours'])
const HEDGES = new Set([
  'appears',
  'can',
  'could',
  'generally',
  'likely',
  'may',
  'might',
  'often',
  'perhaps',
  'possibly',
  'seems',
  'suggests',
  'typically',
])

const TRANSITION_OPENING = /^(additionally|consequently|furthermore|however|in conclusion|in contrast|in summary|moreover|nevertheless|on the other hand|overall|therefore|thus)\b/i
const STOCK_PHRASES = [
  /it is (?:important|essential|crucial) to (?:note|recognize|understand)/gi,
  /plays? (?:a|an) (?:important|key|crucial|vital|significant) role/gi,
  /in today['’]s (?:world|society|digital age)/gi,
  /a wide range of/gi,
  /delve into/gi,
  /multifaceted/gi,
  /underscores? the importance/gi,
  /it is evident that/gi,
]

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function matchWords(text: string): string[] {
  return text.match(WORD_PATTERN) ?? []
}

export function countStatisticalWords(text: string): number {
  return text.match(COVERAGE_WORD_PATTERN)?.length ?? 0
}

function mean(values: number[]): number {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0
}

function populationStandardDeviation(values: number[], average: number): number {
  if (values.length === 0) return 0
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      values.length,
  )
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function contentWordSet(sentence: string): Set<string> {
  return new Set(
    matchWords(sentence)
      .map((word) => word.toLocaleLowerCase())
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  )
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 0
  let intersection = 0
  left.forEach((word) => {
    if (right.has(word)) intersection += 1
  })
  return ratio(intersection, left.size + right.size - intersection)
}

export function splitStatisticalSentences(text: string): string[] {
  const matches =
    text.match(/[^.!?]+(?:[.!?]+["'”’\])}]*|$)/g)?.map((part) => part.trim()) ??
    []
  return matches.filter(Boolean)
}

export function createStatisticalWindows(
  text: string,
  targetSentences = 7,
  stride = 3,
  minimumSentences = 5,
): string[] {
  const sentences = splitStatisticalSentences(text)
  return createStatisticalWindowRanges(
    sentences.length,
    targetSentences,
    stride,
    minimumSentences,
  ).map(({ start, end }) => sentences.slice(start, end).join(' '))
}

export function createStatisticalWindowRanges(
  sentenceCount: number,
  targetSentences = 7,
  stride = 3,
  minimumSentences = 5,
): Array<{ start: number; end: number }> {
  if (sentenceCount < minimumSentences) return []
  if (sentenceCount <= targetSentences) {
    return [{ start: 0, end: sentenceCount }]
  }

  const ranges: Array<{ start: number; end: number }> = []
  const lastStart = sentenceCount - targetSentences
  for (
    let start = 0;
    start <= lastStart;
    start += stride
  ) {
    ranges.push({ start, end: start + targetSentences })
  }
  if (ranges.at(-1)?.start !== lastStart) {
    ranges.push({ start: lastStart, end: sentenceCount })
  }
  return ranges
}

export function extractStatisticalFeatures(
  text: string,
): StatisticalFeatureVector {
  const sentences = splitStatisticalSentences(text)
  const originalWords = matchWords(text)
  const words = originalWords.map((word) => word.toLocaleLowerCase())
  const sentenceWordCounts = sentences.map((sentence) => matchWords(sentence).length)
  const meanSentenceWords = mean(sentenceWordCounts)
  const frequencies = new Map<string, number>()
  words.forEach((word) => frequencies.set(word, (frequencies.get(word) ?? 0) + 1))

  const adjacentOverlaps: number[] = []
  for (let index = 1; index < sentences.length; index += 1) {
    adjacentOverlaps.push(
      jaccard(
        contentWordSet(sentences[index - 1]),
        contentWordSet(sentences[index]),
      ),
    )
  }

  const openers = sentences
    .map((sentence) =>
      matchWords(sentence)
        .slice(0, 2)
        .map((word) => word.toLocaleLowerCase())
        .join(' '),
    )
    .filter(Boolean)
  const uniqueOpeners = new Set(openers)

  let properNounCount = 0
  sentences.forEach((sentence) => {
    matchWords(sentence)
      .slice(1)
      .forEach((word) => {
        if (/^\p{Lu}/u.test(word)) properNounCount += 1
      })
  })

  const stockPhraseCount = STOCK_PHRASES.reduce(
    (total, pattern) => total + countMatches(text, pattern),
    0,
  )
  const passiveConstructionCount = countMatches(
    text,
    /\b(?:am|are|be|been|being|is|was|were)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/gi,
  )

  return {
    meanSentenceWords,
    sentenceLengthCv: ratio(
      populationStandardDeviation(sentenceWordCounts, meanSentenceWords),
      meanSentenceWords,
    ),
    shortSentenceRatio: ratio(
      sentenceWordCounts.filter((count) => count <= 8).length,
      sentences.length,
    ),
    longSentenceRatio: ratio(
      sentenceWordCounts.filter((count) => count >= 28).length,
      sentences.length,
    ),
    meanWordLength: mean(words.map((word) => word.replace(/['’]/g, '').length)),
    repeatedWordRatio:
      words.length > 0 ? 1 - ratio(frequencies.size, words.length) : 0,
    hapaxRatio: ratio(
      [...frequencies.values()].filter((count) => count === 1).length,
      frequencies.size,
    ),
    stopwordRatio: ratio(words.filter((word) => STOPWORDS.has(word)).length, words.length),
    firstPersonRatio: ratio(
      words.filter((word) => FIRST_PERSON.has(word)).length,
      words.length,
    ),
    contractionRatio: ratio(
      originalWords.filter((word) => /['’]/.test(word)).length,
      words.length,
    ),
    numericTokenRatio: ratio(
      originalWords.filter((word) => /^\p{N}/u.test(word)).length,
      words.length,
    ),
    commaPerSentence: ratio(countMatches(text, /,/g), sentences.length),
    semicolonColonPerSentence: ratio(
      countMatches(text, /[;:]/g),
      sentences.length,
    ),
    parentheticalDashPerSentence: ratio(
      countMatches(text, /[()—–]|\s-\s/g),
      sentences.length,
    ),
    transitionOpeningRatio: ratio(
      sentences.filter((sentence) => TRANSITION_OPENING.test(sentence)).length,
      sentences.length,
    ),
    stockPhrasePerSentence: ratio(stockPhraseCount, sentences.length),
    nominalizationRatio: ratio(
      words.filter(
        (word) =>
          word.length > 5 &&
          /(?:ance|ence|ism|ity|ment|ness|sion|tion)$/.test(word),
      ).length,
      words.length,
    ),
    adjacentSentenceOverlap: mean(adjacentOverlaps),
    repeatedOpenerRatio:
      openers.length > 0 ? 1 - ratio(uniqueOpeners.size, openers.length) : 0,
    properNounRatio: ratio(properNounCount, words.length),
    passiveConstructionRatio: ratio(passiveConstructionCount, sentences.length),
    hedgeRatio: ratio(words.filter((word) => HEDGES.has(word)).length, words.length),
  }
}

export function inferStatisticalLikelihood(
  features: StatisticalFeatureVector,
  profile: StatisticalCalibrationProfile = CALIBRATION_PROFILE,
): number {
  let logit = profile.intercept
  profile.featureNames.forEach((name) => {
    const standardized = (features[name] - profile.means[name]) / profile.scales[name]
    logit += standardized * profile.coefficients[name]
  })
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))))
}

export function predictStatisticalLikelihood(text: string): number {
  if (matchWords(text).length === 0) return 0
  return inferStatisticalLikelihood(extractStatisticalFeatures(text))
}

export const scoreStatisticalWindow = predictStatisticalLikelihood
