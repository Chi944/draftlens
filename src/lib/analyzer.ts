import type {
  AnalysisConfidence,
  AnalysisMethodology,
  AnalysisResult,
  AnalysisStats,
  Classification,
  CoverageResult,
  ExclusionReason,
  FlaggedPassage,
  RevisionCoaching,
  SentenceAnalysis,
  SignalId,
  TopSignal,
  WritingSignal,
} from './types'
import {
  CALIBRATION_PROFILE,
  createStatisticalWindowRanges,
  scoreStatisticalWindow,
} from './statistical-features'
import { classifyDetectedPassageScore } from './passage-bands'

const MIXED_THRESHOLD = 40
const HIGH_THRESHOLD = 65
const COVERAGE_REVIEW_THRESHOLD = 20
const COVERAGE_HIGH_THRESHOLD = 50
const MIN_QUALIFYING_WORDS = 300
const MAX_QUALIFYING_WORDS = 30_000

const SIGNAL_DEFINITIONS: Record<
  SignalId,
  { label: string; description: string }
> = {
  'stock-phrases': {
    label: 'Stock phrasing',
    description:
      'Uses prefabricated framing that can make a claim sound generic or interchangeable.',
  },
  'repetitive-openings': {
    label: 'Repetitive sentence openings',
    description:
      'Several sentences begin with the same sequence, creating a template-like rhythm.',
  },
  'uniform-sentence-length': {
    label: 'Uniform sentence lengths',
    description:
      'Sentence lengths cluster unusually closely instead of varying with the ideas being expressed.',
  },
  'repeated-transitions': {
    label: 'Repeated transitions',
    description:
      'The same signposting transition is reused at the start of multiple sentences.',
  },
  'abstract-language': {
    label: 'Abstract language',
    description:
      'Relies heavily on broad concepts instead of named actors, observable actions, or evidence.',
  },
  'nominalized-language': {
    label: 'Nominalized language',
    description:
      'Packs actions into abstract nouns, which can hide who did what.',
  },
  'low-specificity': {
    label: 'Low specificity',
    description:
      'Makes abstract claims without concrete markers such as names, numbers, quotations, or firsthand observations.',
  },
  'statistical-pattern': {
    label: 'Calibrated passage pattern',
    description:
      'An overlapping passage window matched statistical patterns learned from openly licensed human and AI essay examples.',
  },
}

const STOCK_PHRASE_PATTERNS = [
  /\bin today['’]s (?:rapidly |ever[- ]?)?(?:evolving |changing )?(?:world|landscape)\b/giu,
  /\bit (?:is|remains) important to (?:note|recognize|understand)\b/giu,
  /\bit should be noted that\b/giu,
  /\bplays? a (?:crucial|vital|pivotal|significant) role\b/giu,
  /\ba (?:wide|broad|diverse) range of\b/giu,
  /\bit is (?:clear|evident|apparent) that\b/giu,
  /\bthis (?:highlights|underscores|demonstrates) the importance of\b/giu,
  /\bin conclusion\b/giu,
  /\bwhen it comes to\b/giu,
  /\bdelve(?:s|d)? into\b/giu,
  /\bnavigat(?:e|es|ing) the complexities\b/giu,
  /\b(?:rapidly|ever)[- ]evolving\b/giu,
  /\bholistic approach\b/giu,
  /\brobust framework\b/giu,
  /\bseamless(?:ly)?\b/giu,
  /\bmultifaceted\b/giu,
  /\ba testament to\b/giu,
  /\brich tapestry\b/giu,
  /\bnot only\b[^.!?]{0,90}\bbut also\b/giu,
]

const TRANSITION_PATTERN =
  /^\s*(however|moreover|furthermore|additionally|consequently|therefore|thus|in addition|on the other hand|in conclusion|ultimately|overall|first(?:ly)?|second(?:ly)?|finally)\b[\s,:;—-]*/iu

const ABSTRACT_TERMS = new Set([
  'adaptation',
  'advancement',
  'approach',
  'aspect',
  'challenge',
  'complexity',
  'comprehensive',
  'consideration',
  'context',
  'crucial',
  'development',
  'dynamic',
  'effectiveness',
  'efficiency',
  'enhancement',
  'essential',
  'evolution',
  'facilitation',
  'factor',
  'framework',
  'holistic',
  'implementation',
  'importance',
  'improvement',
  'innovation',
  'innovative',
  'integration',
  'landscape',
  'methodology',
  'multifaceted',
  'optimization',
  'outcome',
  'paradigm',
  'perspective',
  'pivotal',
  'potential',
  'process',
  'progress',
  'quality',
  'robust',
  'significance',
  'significant',
  'solution',
  'strategy',
  'transformation',
  'utilization',
  'value',
])

const NOMINALIZATION_PATTERN =
  /(?:tion|sion|ment|ness|ance|ence|ity|ization|isation|ship|acy)$/iu

const ABBREVIATIONS = new Set([
  'approx.',
  'dr.',
  'e.g.',
  'etc.',
  'fig.',
  'i.e.',
  'jr.',
  'mr.',
  'mrs.',
  'ms.',
  'no.',
  'prof.',
  'sr.',
  'st.',
  'vs.',
])

const TERMINAL_CAPABLE_ABBREVIATIONS = new Set([
  'approx.',
  'etc.',
  'fig.',
  'no.',
  'vs.',
])

const METHODOLOGY: AnalysisMethodology = {
  name: 'DraftLens qualifying-prose coverage estimator',
  version: '2.0',
  kind: 'calibrated-writing-pattern-estimator',
  description:
    'A local estimator that filters for long-form prose, scores overlapping passage windows, and reports detected-word coverage. The same text always produces the same result.',
  scoreMeaning:
    'The percentage is the share of qualifying prose words inside passages that crossed DraftLens\' calibrated statistical threshold. It is not the probability that AI wrote the document.',
  thresholds: {
    low: '0 or a suppressed raw result from 1-19%',
    mixed: '20-49% of qualifying prose words detected',
    high: '50-100% of qualifying prose words detected',
  },
  heuristics: [
    'Qualifying long-form prose only; references and non-prose are excluded',
    'Overlapping local windows of 5-10 sentences',
    'A versioned statistical calibration trained on openly licensed human and AI essays',
    'Recognizable stock phrases',
    'Repeated sentence openings',
    'Unusually uniform sentence lengths',
    'Repeated sentence-opening transitions',
    'Dense abstract vocabulary',
    'Dense nominalizations',
    'Abstract claims with few concrete markers',
  ],
}

const LIMITATIONS = [
  'DraftLens is an independent writing-pattern tool. It is not Turnitin, is not affiliated with Turnitin, and does not reproduce any proprietary detector.',
  'This coverage estimate cannot establish authorship or prove that text was written by AI or by a person.',
  'Formal, technical, translated, template-based, or heavily edited human writing may trigger the same patterns.',
  'Fewer than 300 qualifying words are outside the supported range and do not receive a reportable percentage.',
  'Scores from 1-19% are suppressed because low-coverage highlights carry a higher false-positive risk.',
  'The statistical profile uses public research data and is smaller than a production transformer model; domain and model drift remain important limitations.',
  'Revision coaching is intended to improve clarity, specificity, and personal voice. It does not promise to change or bypass any third-party detector score.',
]

interface SentenceSpan {
  text: string
  start: number
  end: number
}

interface TransitionMatch {
  key: string
  evidence: string
  end: number
}

interface SentenceDraft extends SentenceSpan {
  index: number
  words: string[]
  wordCount: number
  qualifies: boolean
  exclusionReason?: ExclusionReason
  openingKey?: string
  openingEvidence?: string
  transition?: TransitionMatch
  stockEvidence: string[]
  abstractEvidence: string[]
  nominalizationEvidence: string[]
}

interface LineAssessment {
  start: number
  end: number
  reason?: ExclusionReason
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function classifyPatternScore(score: number): Classification {
  if (score >= HIGH_THRESHOLD) return 'high'
  if (score >= MIXED_THRESHOLD) return 'mixed'
  return 'low'
}

function wordsIn(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’’-][\p{L}\p{N}]+)*/gu) ?? []
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()

  return values.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function nextNonWhitespace(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (!/\s/u.test(text[index])) return index
  }
  return -1
}

function nextSentenceStarter(text: string, from: number): number {
  let index = nextNonWhitespace(text, from)

  while (index !== -1 && /["'“”‘’)}\]]/u.test(text[index])) {
    index = nextNonWhitespace(text, index + 1)
  }

  return index
}

function isInternalPeriod(text: string, index: number, sentenceStart: number): boolean {
  if (/\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '')) {
    return true
  }

  const fragment = text.slice(Math.max(sentenceStart, index - 14), index + 1)
  const token = fragment.match(/([\p{L}.]+\.)$/u)?.[1]?.toLowerCase()
  const nextIndex = nextSentenceStarter(text, index + 1)
  if (!token || nextIndex === -1) return false

  if (
    TERMINAL_CAPABLE_ABBREVIATIONS.has(token) &&
    /\p{Lu}/u.test(text[nextIndex])
  ) {
    return false
  }

  return ABBREVIATIONS.has(token) || /^(?:\p{L}\.){2,}$/u.test(token)
}

function pushSentence(
  spans: SentenceSpan[],
  text: string,
  rawStart: number,
  rawEnd: number,
): void {
  let start = rawStart
  let end = rawEnd

  while (start < end && /\s/u.test(text[start])) start += 1
  while (end > start && /\s/u.test(text[end - 1])) end -= 1

  if (start < end && wordsIn(text.slice(start, end)).length > 0) {
    spans.push({ text: text.slice(start, end), start, end })
  }
}

function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  let sentenceStart = nextNonWhitespace(text, 0)
  if (sentenceStart === -1) return spans

  let index = sentenceStart
  while (index < text.length) {
    const character = text[index]

    if (character === '\n') {
      const blankLine = text.slice(index).match(/^\n[\t ]*\r?\n/u)?.[0]
      if (blankLine) {
        pushSentence(spans, text, sentenceStart, index)
        index += blankLine.length
        sentenceStart = nextNonWhitespace(text, index)
        if (sentenceStart === -1) break
        index = sentenceStart
        continue
      }
    }

    if (character === '.' || character === '!' || character === '?') {
      if (character === '.' && isInternalPeriod(text, index, sentenceStart)) {
        index += 1
        continue
      }

      let end = index + 1
      while (end < text.length && /[.!?]/u.test(text[end])) end += 1
      while (end < text.length && /["'”’)}\]]/u.test(text[end])) end += 1

      if (end === text.length || /\s/u.test(text[end])) {
        pushSentence(spans, text, sentenceStart, end)
        sentenceStart = nextNonWhitespace(text, end)
        if (sentenceStart === -1) break
        index = sentenceStart
        continue
      }
    }

    index += 1
  }

  if (sentenceStart !== -1 && sentenceStart < text.length) {
    const lastSpan = spans.at(-1)
    if (!lastSpan || sentenceStart >= lastSpan.end) {
      pushSentence(spans, text, sentenceStart, text.length)
    }
  }

  return spans
}

function collectPatternEvidence(text: string): string[] {
  const matches: string[] = []

  STOCK_PHRASE_PATTERNS.forEach((pattern) => {
    const freshPattern = new RegExp(pattern.source, pattern.flags)
    for (const match of text.matchAll(freshPattern)) {
      if (match[0]) matches.push(match[0])
    }
  })

  return unique(matches)
}

function findTransition(text: string): TransitionMatch | undefined {
  const match = text.match(TRANSITION_PATTERN)
  if (!match?.[1]) return undefined

  return {
    key: match[1].toLowerCase(),
    evidence: match[1],
    end: match[0].length,
  }
}

const REFERENCE_HEADING_PATTERN =
  /^\s*(?:\d{1,4}\s+)?(?:references?|referencias|referensi|références|bibliography|works\s+cited|reference\s+list|daftar\s+pustaka|literaturverzeichnis)\b\s*:?/iu
const LIST_ITEM_PATTERN = /^\s*(?:[-*\u2022\u25aa\u25e6]|\d{1,3}[.)]|[a-z][.)])\s+/iu
const PAGE_NUMBER_PATTERN =
  /^\s*(?:page\s+)?\d{1,4}(?:\s+(?:of|\/|-|\u2013)\s*\d{1,4})?\s*$/iu
const TOC_PATTERN = /\.{3,}\s*\d{1,4}\s*$/u
const CODE_START_PATTERN =
  /^\s*(?:```|~~~|(?:export\s+)?(?:async\s+)?function\b|(?:const|let|var|class|interface|type)\s+[\w$]+\s*(?:[=:<{(]))/u

const ENGLISH_FUNCTION_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'were',
  'which',
  'with',
])

const NON_ENGLISH_FUNCTION_WORDS = new Set([
  'adalah',
  'atau',
  'dalam',
  'dan',
  'dari',
  'dengan',
  'ini',
  'pada',
  'untuk',
  'yang',
  'de',
  'del',
  'el',
  'en',
  'la',
  'las',
  'los',
  'para',
  'por',
  'que',
  'una',
  'une',
  'des',
  'dans',
  'les',
  'pour',
])

function looksLikeUnsupportedLanguage(text: string): boolean {
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) {
    return true
  }

  const words = wordsIn(text).map((word) => word.toLowerCase())
  if (words.length < 6) return false

  const englishCount = words.filter((word) =>
    ENGLISH_FUNCTION_WORDS.has(word),
  ).length
  const otherCount = words.filter((word) =>
    NON_ENGLISH_FUNCTION_WORDS.has(word),
  ).length

  return otherCount >= 2 && otherCount > englishCount
}

function looksLikeHeading(line: string, wordCount: number): boolean {
  if (wordCount === 0 || wordCount > 30) return false
  if (/[.!?]["'\u201d\u2019)}\]]*\s*$/u.test(line)) return false
  const allCapsLetters = line.match(/\p{L}/gu)?.join('') ?? ''
  if (
    allCapsLetters.length >= 3 &&
    allCapsLetters === allCapsLetters.toUpperCase()
  ) {
    return true
  }
  if (wordCount > 14) return false
  if (/[:\u2014-]\s*$/u.test(line) && wordCount <= 12) return true
  if (wordCount <= 5) return true

  const words = wordsIn(line)
  const casedWords = words.filter((word) => /\p{L}/u.test(word))
  const titleCaseWords = casedWords.filter((word) => /^\p{Lu}/u.test(word))

  return (
    casedWords.length > 0 &&
    titleCaseWords.length / casedWords.length >= 0.75
  )
}

function assessLines(text: string): LineAssessment[] {
  const assessments: LineAssessment[] = []
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu
  let bibliographyStarted = false
  let inCodeFence = false

  for (const match of text.matchAll(linePattern)) {
    if (match.index === undefined || match[0].length === 0) continue
    const rawLine = match[0]
    const line = rawLine.replace(/[\r\n]+$/u, '')
    const start = match.index
    const end = start + line.length
    const trimmed = line.trim()
    const wordCount = wordsIn(trimmed).length
    let reason: ExclusionReason | undefined

    const referenceHeading = trimmed.match(REFERENCE_HEADING_PATTERN)
    const referenceRemainder = referenceHeading
      ? trimmed.slice(referenceHeading[0].length).trim()
      : ''
    if (
      referenceHeading &&
      start >= text.length * 0.1 &&
      !/^(?:\.{2,}\s*)?\d{1,4}$/u.test(referenceRemainder)
    ) {
      bibliographyStarted = true
    }

    if (bibliographyStarted) {
      reason = 'bibliography'
    } else if (/^\s*(?:```|~~~)/u.test(trimmed)) {
      inCodeFence = !inCodeFence
      reason = 'non-prose'
    } else if (inCodeFence || CODE_START_PATTERN.test(trimmed)) {
      reason = 'non-prose'
    } else if (!trimmed) {
      reason = 'non-prose'
    } else if (
      PAGE_NUMBER_PATTERN.test(trimmed) ||
      TOC_PATTERN.test(trimmed) ||
      LIST_ITEM_PATTERN.test(trimmed) ||
      /^\s*(?:name|student\s+id|program(?:\s+studi)?|title|type\s+of\s+submission|signature|date|faculty|university|place\s+of\s+approval|npm|tanda\s+tangan|tahun\s+akademik)\s*:/iu.test(
        trimmed,
      ) ||
      /^\s*(?:https?:\/\/|www\.|doi\s*:|submission\s+id\b|file\s+name\b)/iu.test(
        trimmed,
      )
    ) {
      reason = 'non-prose'
    } else {
      const tableSeparators =
        (trimmed.match(/\t/gu)?.length ?? 0) +
        (trimmed.match(/\|/gu)?.length ?? 0)
      const terminalMarks = trimmed.match(/[.!?](?:\s|$)/gu)?.length ?? 0
      if (tableSeparators >= 2 && (wordCount < 40 || terminalMarks < 2)) {
        reason = 'non-prose'
      } else if (looksLikeUnsupportedLanguage(trimmed)) {
        reason = 'unsupported-language'
      } else if (looksLikeHeading(trimmed, wordCount)) {
        reason = 'non-prose'
      }
    }

    assessments.push({ start, end, ...(reason ? { reason } : {}) })
  }

  return assessments
}

function qualifySentence(
  span: SentenceSpan,
  lines: LineAssessment[],
): { qualifies: boolean; exclusionReason?: ExclusionReason } {
  const letters = span.text.match(/\p{L}/gu) ?? []
  const uppercaseLetters = letters.filter((letter) =>
    /\p{Lu}/u.test(letter),
  ).length
  const terminalCount = span.text.match(/[.!?](?:\s|$)/gu)?.length ?? 0
  const metadataLabelCount =
    span.text.match(
      /\b(?:name|student\s+id|program(?:\s+studi)?|title|type\s+of\s+submission|signature|date|faculty|university|place\s+of\s+approval|npm|tanda\s+tangan|tahun\s+akademik)\s*:/giu,
    )?.length ?? 0
  const tocEntryCount = span.text.match(/\.{3,}\s*\d{1,4}/gu)?.length ?? 0

  if (
    (letters.length >= 20 &&
      terminalCount === 0 &&
      uppercaseLetters / letters.length >= 0.6) ||
    (metadataLabelCount >= 3 && terminalCount <= 2) ||
    tocEntryCount >= 3
  ) {
    return { qualifies: false, exclusionReason: 'non-prose' }
  }

  const overlapping = lines.filter(
    (line) => line.end > span.start && line.start < span.end,
  )
  let qualifyingWords = 0
  const excludedWords = new Map<ExclusionReason, number>()

  overlapping.forEach((line) => {
    const start = Math.max(span.start, line.start)
    const end = Math.min(span.end, line.end)
    const count = wordsIn(span.text.slice(start - span.start, end - span.start)).length
    if (!line.reason) {
      qualifyingWords += count
      return
    }
    excludedWords.set(line.reason, (excludedWords.get(line.reason) ?? 0) + count)
  })

  const excludedWordCount = [...excludedWords.values()].reduce(
    (sum, count) => sum + count,
    0,
  )

  if (qualifyingWords > 0 && qualifyingWords >= excludedWordCount) {
    if (looksLikeUnsupportedLanguage(span.text)) {
      return { qualifies: false, exclusionReason: 'unsupported-language' }
    }
    return { qualifies: true }
  }

  const exclusionReason = [...excludedWords.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0]

  return {
    qualifies: false,
    exclusionReason: exclusionReason ?? 'non-prose',
  }
}

function makeSentenceDraft(
  span: SentenceSpan,
  index: number,
  lines: LineAssessment[],
): SentenceDraft {
  const words = wordsIn(span.text)
  const normalizedWords = words.map((word) => word.toLowerCase())
  const transition = findTransition(span.text)
  const openingWords = wordsIn(
    transition ? span.text.slice(transition.end) : span.text,
  ).slice(0, 3)
  const abstractEvidence = unique(
    normalizedWords.filter((word) => ABSTRACT_TERMS.has(word)),
  )
  const nominalizationEvidence = unique(
    normalizedWords.filter(
      (word) => word.length >= 7 && NOMINALIZATION_PATTERN.test(word),
    ),
  )
  const qualification = qualifySentence(span, lines)

  return {
    ...span,
    index,
    words,
    wordCount: words.length,
    ...qualification,
    openingKey:
      openingWords.length === 3
        ? openingWords.map((word) => word.toLowerCase()).join(' ')
        : undefined,
    openingEvidence:
      openingWords.length === 3 ? openingWords.join(' ') : undefined,
    transition,
    stockEvidence: collectPatternEvidence(span.text),
    abstractEvidence,
    nominalizationEvidence,
  }
}

function occurrenceCounts(
  values: Array<string | undefined>,
): Map<string, number> {
  const counts = new Map<string, number>()
  values.forEach((value) => {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  })
  return counts
}

function lengthVariation(wordCounts: number[]): number {
  if (wordCounts.length < 2) return 0
  const mean = wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length
  if (mean === 0) return 0
  const variance =
    wordCounts.reduce((sum, count) => sum + (count - mean) ** 2, 0) /
    wordCounts.length
  return Math.sqrt(variance) / mean
}

function makeSignal(
  id: SignalId,
  impact: number,
  evidence: string[],
): WritingSignal {
  return {
    id,
    ...SIGNAL_DEFINITIONS[id],
    impact,
    evidence,
  }
}

function hasConcreteMarkers(text: string, words: string[]): boolean {
  if (/\d/u.test(text)) return true
  if (/[“”"]/u.test(text)) return true
  if (/\b(?:I|we|my|our|me|us)\b/u.test(text)) return true

  return words.slice(1).some((word) => /^[\p{Lu}][\p{Ll}]{2,}$/u.test(word))
}

function scoreSentence(
  draft: SentenceDraft,
  openingCounts: Map<string, number>,
  transitionCounts: Map<string, number>,
  uniformLengthImpact: number,
): SentenceAnalysis {
  const signals: WritingSignal[] = []

  if (!draft.qualifies) {
    return {
      id: `sentence-${draft.index + 1}`,
      index: draft.index,
      text: draft.text,
      start: draft.start,
      end: draft.end,
      wordCount: draft.wordCount,
      qualifies: false,
      ...(draft.exclusionReason
        ? { exclusionReason: draft.exclusionReason }
        : {}),
      likelihood: 0,
      detected: false,
      patternScore: 0,
      score: 0,
      classification: 'low',
      signals: [],
    }
  }

  if (draft.stockEvidence.length > 0) {
    signals.push(
      makeSignal(
        'stock-phrases',
        Math.min(42, 32 + (draft.stockEvidence.length - 1) * 6),
        draft.stockEvidence,
      ),
    )
  }

  const openingCount = draft.openingKey
    ? (openingCounts.get(draft.openingKey) ?? 0)
    : 0
  if (draft.openingEvidence && openingCount >= 2) {
    signals.push(
      makeSignal(
        'repetitive-openings',
        Math.min(20, 14 + (openingCount - 2) * 2),
        [`“${draft.openingEvidence}” opens ${openingCount} sentences`],
      ),
    )
  }

  const transitionCount = draft.transition
    ? (transitionCounts.get(draft.transition.key) ?? 0)
    : 0
  if (draft.transition && transitionCount >= 2) {
    signals.push(
      makeSignal('repeated-transitions', 16, [
        `“${draft.transition.evidence}” opens ${transitionCount} sentences`,
      ]),
    )
  }

  if (uniformLengthImpact > 0) {
    signals.push(
      makeSignal('uniform-sentence-length', uniformLengthImpact, [
        'Sentence lengths vary little across this sample',
      ]),
    )
  }

  const abstractRatio =
    draft.wordCount === 0
      ? 0
      : draft.abstractEvidence.length / draft.wordCount
  if (draft.abstractEvidence.length >= 2 && abstractRatio >= 0.1) {
    signals.push(
      makeSignal(
        'abstract-language',
        Math.min(22, 10 + Math.round(abstractRatio * 45)),
        draft.abstractEvidence,
      ),
    )
  }

  const nominalizationRatio =
    draft.wordCount === 0
      ? 0
      : draft.nominalizationEvidence.length / draft.wordCount
  if (
    draft.nominalizationEvidence.length >= 2 &&
    nominalizationRatio >= 0.08
  ) {
    signals.push(
      makeSignal(
        'nominalized-language',
        Math.min(20, 8 + Math.round(nominalizationRatio * 50)),
        draft.nominalizationEvidence,
      ),
    )
  }

  if (
    draft.wordCount >= 9 &&
    abstractRatio >= 0.1 &&
    !hasConcreteMarkers(draft.text, draft.words)
  ) {
    signals.push(
      makeSignal('low-specificity', 10, [
        'No names, numbers, quotations, or firsthand markers accompany the abstract terms',
      ]),
    )
  }

  const score = clampScore(
    (draft.wordCount >= 4 ? 8 : 4) +
      signals.reduce((sum, signal) => sum + signal.impact, 0),
  )

  return {
    id: `sentence-${draft.index + 1}`,
    index: draft.index,
    text: draft.text,
    start: draft.start,
    end: draft.end,
    wordCount: draft.wordCount,
    qualifies: true,
    likelihood: 0,
    detected: false,
    patternScore: score,
    score,
    classification: classifyPatternScore(score),
    signals,
  }
}

function applyStatisticalScores(
  sentences: SentenceAnalysis[],
): SentenceAnalysis[] {
  const qualifying = sentences.filter((sentence) => sentence.qualifies)
  if (qualifying.length === 0) return sentences

  const probabilitySums = new Array<number>(qualifying.length).fill(0)
  const windowCounts = new Array<number>(qualifying.length).fill(0)

  const ranges = createStatisticalWindowRanges(qualifying.length, 7, 3, 5)
  if (ranges.length === 0) ranges.push({ start: 0, end: qualifying.length })

  ranges.forEach(({ start, end }) => {
    const probability = scoreStatisticalWindow(
      qualifying
        .slice(start, end)
        .map((sentence) => sentence.text)
        .join(' '),
    )
    for (let index = start; index < end; index += 1) {
      probabilitySums[index] += probability
      windowCounts[index] += 1
    }
  })

  const scoredById = new Map<string, SentenceAnalysis>()
  qualifying.forEach((sentence, index) => {
    const probability =
      windowCounts[index] === 0
        ? 0
        : probabilitySums[index] / windowCounts[index]
    const likelihood = clampScore(probability * 100)
    const detected = probability >= CALIBRATION_PROFILE.detectionThreshold
    const signals = detected
      ? [
          ...sentence.signals,
          makeSignal('statistical-pattern', 20, [
            `${likelihood}% local estimate across ${windowCounts[index]} overlapping passage window${windowCounts[index] === 1 ? '' : 's'}`,
          ]),
        ]
      : sentence.signals

    scoredById.set(sentence.id, {
      ...sentence,
      likelihood,
      detected,
      score: likelihood,
      classification: classifyDetectedPassageScore(likelihood, detected),
      signals,
    })
  })

  return sentences.map((sentence) => scoredById.get(sentence.id) ?? sentence)
}

function aggregateSignals(sentences: SentenceAnalysis[]): TopSignal[] {
  const aggregates = new Map<
    SignalId,
    {
      sentenceIds: Set<string>
      occurrenceCount: number
      totalImpact: number
      evidence: string[]
    }
  >()

  sentences.forEach((sentence) => {
    sentence.signals.forEach((signal) => {
      const aggregate = aggregates.get(signal.id) ?? {
        sentenceIds: new Set<string>(),
        occurrenceCount: 0,
        totalImpact: 0,
        evidence: [],
      }
      aggregate.sentenceIds.add(sentence.id)
      aggregate.occurrenceCount += Math.max(1, signal.evidence.length)
      aggregate.totalImpact += signal.impact
      aggregate.evidence.push(...signal.evidence)
      aggregates.set(signal.id, aggregate)
    })
  })

  return [...aggregates.entries()]
    .map(([id, aggregate]) => ({
      id,
      ...SIGNAL_DEFINITIONS[id],
      affectedSentenceCount: aggregate.sentenceIds.size,
      occurrenceCount: aggregate.occurrenceCount,
      totalImpact: aggregate.totalImpact,
      evidence: unique(aggregate.evidence).slice(0, 5),
    }))
    .sort(
      (left, right) =>
        right.totalImpact - left.totalImpact ||
        right.affectedSentenceCount - left.affectedSentenceCount ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
}

function weightedScore(sentences: SentenceAnalysis[]): number {
  const totalWeight = sentences.reduce(
    (sum, sentence) => sum + Math.max(1, sentence.wordCount),
    0,
  )
  if (totalWeight === 0) return 0

  return clampScore(
    sentences.reduce(
      (sum, sentence) =>
        sum + sentence.score * Math.max(1, sentence.wordCount),
      0,
    ) / totalWeight,
  )
}

function weightedPatternScore(sentences: SentenceAnalysis[]): number {
  const qualifying = sentences.filter((sentence) => sentence.qualifies)
  const totalWeight = qualifying.reduce(
    (sum, sentence) => sum + Math.max(1, sentence.wordCount),
    0,
  )
  if (totalWeight === 0) return 0

  return clampScore(
    qualifying.reduce(
      (sum, sentence) =>
        sum + sentence.patternScore * Math.max(1, sentence.wordCount),
      0,
    ) / totalWeight,
  )
}

function makeFlaggedPassages(
  text: string,
  sentences: SentenceAnalysis[],
): FlaggedPassage[] {
  const groups: SentenceAnalysis[][] = []
  let current: SentenceAnalysis[] = []
  let currentWords = 0

  const flush = () => {
    if (current.length > 0) groups.push(current)
    current = []
    currentWords = 0
  }

  sentences.forEach((sentence) => {
    if (sentence.qualifies && sentence.detected) {
      if (
        current.length >= 8 ||
        (current.length > 0 && currentWords + sentence.wordCount > 240)
      ) {
        flush()
      }
      current.push(sentence)
      currentWords += sentence.wordCount
      return
    }

    flush()
  })
  flush()

  return groups.map((group, index) => {
    const first = group[0]
    const last = group[group.length - 1]
    const score = weightedScore(group)

    return {
      id: `passage-${index + 1}`,
      start: first.start,
      end: last.end,
      text: text.slice(first.start, last.end),
      score,
      classification: classifyDetectedPassageScore(score, true),
      sentenceIds: group.map((sentence) => sentence.id),
      signals: aggregateSignals(group).slice(0, 4),
    }
  })
}

function classifyCoverage(score: number): Classification {
  if (score >= COVERAGE_HIGH_THRESHOLD) return 'high'
  if (score >= COVERAGE_REVIEW_THRESHOLD) return 'mixed'
  return 'low'
}

function makeCoverage(
  text: string,
  sentences: SentenceAnalysis[],
): CoverageResult {
  const qualifying = sentences.filter((sentence) => sentence.qualifies)
  const qualifyingWordCount = qualifying.reduce(
    (sum, sentence) => sum + sentence.wordCount,
    0,
  )
  const detected = qualifying.filter((sentence) => sentence.detected)
  const detectedWordCount = detected.reduce(
    (sum, sentence) => sum + sentence.wordCount,
    0,
  )
  const excludedWordCount = Math.max(
    0,
    wordsIn(text).length - qualifyingWordCount,
  )
  const rawPercent =
    qualifyingWordCount === 0
      ? 0
      : clampScore((detectedWordCount / qualifyingWordCount) * 100)

  if (qualifyingWordCount < MIN_QUALIFYING_WORDS) {
    return {
      rawPercent,
      displayedPercent: null,
      displayLabel: 'Not enough prose',
      status: 'insufficient-prose',
      qualifyingWordCount,
      detectedWordCount,
      excludedWordCount,
      qualifyingSentenceCount: qualifying.length,
      detectedSentenceCount: detected.length,
    }
  }

  if (qualifyingWordCount > MAX_QUALIFYING_WORDS) {
    return {
      rawPercent,
      displayedPercent: null,
      displayLabel: 'Outside range',
      status: 'out-of-range',
      qualifyingWordCount,
      detectedWordCount,
      excludedWordCount,
      qualifyingSentenceCount: qualifying.length,
      detectedSentenceCount: detected.length,
    }
  }

  if (rawPercent > 0 && rawPercent < COVERAGE_REVIEW_THRESHOLD) {
    return {
      rawPercent,
      displayedPercent: null,
      displayLabel: '*%',
      status: 'below-reporting-threshold',
      qualifyingWordCount,
      detectedWordCount,
      excludedWordCount,
      qualifyingSentenceCount: qualifying.length,
      detectedSentenceCount: detected.length,
    }
  }

  return {
    rawPercent,
    displayedPercent: rawPercent,
    displayLabel: `${rawPercent}%`,
    status: 'exact',
    qualifyingWordCount,
    detectedWordCount,
    excludedWordCount,
    qualifyingSentenceCount: qualifying.length,
    detectedSentenceCount: detected.length,
  }
}

function makeConfidence(
  wordCount: number,
  sentenceCount: number,
): AnalysisConfidence {
  const score = clampScore(
    Math.min(75, (wordCount / 1_000) * 75) +
      Math.min(25, (sentenceCount / 40) * 25),
  )

  if (wordCount === 0) {
    return {
      level: 'low',
      score: 0,
      label: 'No sample',
      reason: 'No qualifying long-form prose was available for this estimate.',
    }
  }

  if (wordCount < MIN_QUALIFYING_WORDS) {
    return {
      level: 'low',
      score,
      label: 'Low confidence',
      reason: `Only ${wordCount} qualifying words across ${sentenceCount} sentence${sentenceCount === 1 ? '' : 's'} were available; at least ${MIN_QUALIFYING_WORDS} are required for a reportable estimate.`,
    }
  }

  if (wordCount < 1_000 || sentenceCount < 30) {
    return {
      level: 'medium',
      score,
      label: 'Medium confidence',
      reason: `${wordCount} qualifying words across ${sentenceCount} sentences support an estimate, but a broader sample would stabilize passage-level variation.`,
    }
  }

  return {
    level: 'high',
    score,
    label: 'Higher confidence',
    reason: `${wordCount} qualifying words across ${sentenceCount} sentences provide multiple overlapping windows for the local estimator.`,
  }
}

const COACHING_BY_SIGNAL: Record<
  SignalId,
  Omit<RevisionCoaching, 'id' | 'priority' | 'relatedSignalIds'>
> = {
  'stock-phrases': {
    title: 'Lead with the actual claim',
    rationale:
      'Stock framing delays the useful point and can make different paragraphs sound interchangeable.',
    action:
      'Remove the prefabricated lead-in, then state the result, constraint, or disagreement directly. Keep only wording that adds meaning.',
    example:
      'Instead of “It is important to note that service improved,” write the verified change: “Median wait time fell from 12 minutes to 8 after the Tuesday rota change.”',
  },
  'repetitive-openings': {
    title: 'Let each sentence follow its idea',
    rationale:
      'Repeated openings create a mechanical cadence even when the underlying points differ.',
    action:
      'Combine closely related claims, name the actor first where useful, and vary the opening only when the logic genuinely changes.',
  },
  'uniform-sentence-length': {
    title: 'Vary rhythm to match emphasis',
    rationale:
      'A narrow length range can flatten the hierarchy between evidence, explanation, and conclusions.',
    action:
      'Use a short sentence for the main finding. Combine supporting details that belong together, and split any sentence carrying two separate claims.',
  },
  'repeated-transitions': {
    title: 'Make the relationship explicit',
    rationale:
      'Repeated signposts can substitute for explaining how one claim follows from another.',
    action:
      'Delete transitions that add no logic. Where a link matters, name it precisely: contrast, cause, consequence, exception, or sequence.',
  },
  'abstract-language': {
    title: 'Ground concepts in observable evidence',
    rationale:
      'Abstract terms are hard to assess when the reader cannot see the event, actor, measure, or source behind them.',
    action:
      'For each broad claim, add one accurate example: who acted, what changed, when it happened, and what evidence supports it.',
  },
  'nominalized-language': {
    title: 'Turn hidden actions back into verbs',
    rationale:
      'Nominalizations such as “implementation” and “optimization” can conceal responsibility and make prose heavier.',
    action:
      'Name the actor and use the underlying verb. Check that the actor and action are supported by the report.',
    example:
      'Replace “the implementation of the policy led to improvement” with a verified actor and action, such as “The clinic introduced the policy in May; missed appointments then fell by 9%.”',
  },
  'low-specificity': {
    title: 'Add details only this report could contain',
    rationale:
      'Specific, verifiable details make a draft more useful and reveal the writer’s actual point of view.',
    action:
      'Add accurate names, dates, quantities, source observations, constraints, or a brief firsthand explanation. Never invent detail merely to change a score.',
  },
  'statistical-pattern': {
    title: 'Review the passage in context',
    rationale:
      'The local passage crossed a calibrated statistical threshold, but that result does not identify its author or a single decisive phrase.',
    action:
      'Compare the passage with notes, sources, and earlier drafts. Revise only where the wording does not accurately reflect the writer\'s own reasoning or evidence.',
  },
}

function makeCoaching(topSignals: TopSignal[]): RevisionCoaching[] {
  if (topSignals.length === 0) return []

  return topSignals.slice(0, 4).map((signal, index) => ({
    id: `coaching-${signal.id}`,
    priority: index === 0 ? 'high' : index < 3 ? 'medium' : 'low',
    ...COACHING_BY_SIGNAL[signal.id],
    relatedSignalIds: [signal.id],
  }))
}

function makeSummary(
  coverage: CoverageResult,
  confidence: AnalysisConfidence,
): string {
  if (confidence.score === 0) {
    return 'No qualifying long-form prose was available for analysis.'
  }

  if (coverage.status === 'insufficient-prose') {
    return `${coverage.qualifyingWordCount} qualifying words were found; at least ${MIN_QUALIFYING_WORDS} are required for a reportable estimate.`
  }
  if (coverage.status === 'out-of-range') {
    return `${coverage.qualifyingWordCount} qualifying words exceed the ${MAX_QUALIFYING_WORDS.toLocaleString()}-word supported range.`
  }
  if (coverage.status === 'below-reporting-threshold') {
    return `Some passage-level patterns were detected, but the exact result is suppressed below ${COVERAGE_REVIEW_THRESHOLD}% because low-coverage highlights are less reliable.`
  }

  return `${coverage.rawPercent}% of ${coverage.qualifyingWordCount.toLocaleString()} qualifying prose words fell inside detected passages. This is a ${confidence.level}-confidence estimate, not proof of AI authorship.`
}

function makeStats(
  text: string,
  sentences: SentenceAnalysis[],
  passages: FlaggedPassage[],
  coverage: CoverageResult,
): AnalysisStats {
  const allWords = wordsIn(text)
  const qualifyingSentences = sentences.filter((sentence) => sentence.qualifies)
  const qualifyingWords = qualifyingSentences.flatMap((sentence) =>
    wordsIn(sentence.text),
  )
  const normalizedWords = qualifyingWords.map((word) => word.toLowerCase())
  const trimmed = text.trim()
  const paragraphCount = trimmed
    ? trimmed.split(/\r?\n\s*\r?\n+/u).filter((paragraph) => /\S/u.test(paragraph))
        .length
    : 0
  const averageSentenceLength =
    qualifyingSentences.length === 0
      ? 0
      : coverage.qualifyingWordCount / qualifyingSentences.length

  return {
    characterCount: trimmed.length,
    wordCount: allWords.length,
    qualifyingWordCount: coverage.qualifyingWordCount,
    excludedWordCount: coverage.excludedWordCount,
    detectedWordCount: coverage.detectedWordCount,
    sentenceCount: sentences.length,
    qualifyingSentenceCount: coverage.qualifyingSentenceCount,
    detectedSentenceCount: coverage.detectedSentenceCount,
    paragraphCount,
    averageSentenceLength: Math.round(averageSentenceLength * 10) / 10,
    sentenceLengthVariation: Math.round(
      lengthVariation(
        qualifyingSentences.map((sentence) => sentence.wordCount),
      ) * 100,
    ),
    flaggedSentenceCount: coverage.detectedSentenceCount,
    flaggedPassageCount: passages.length,
    uniqueWordRatio:
      qualifyingWords.length === 0
        ? 0
        : Math.round(
            (new Set(normalizedWords).size / qualifyingWords.length) * 100,
          ),
  }
}

/**
 * Produces a deterministic, local qualifying-prose coverage estimate.
 * It does not call a remote AI service, determine authorship, or reproduce Turnitin.
 */
export function analyzeText(text: string): AnalysisResult {
  const lines = assessLines(text)
  const drafts = splitSentences(text).map((span, index) =>
    makeSentenceDraft(span, index, lines),
  )
  const qualifyingDrafts = drafts.filter((draft) => draft.qualifies)
  const qualifyingPositions = new Map(
    qualifyingDrafts.map((draft, index) => [draft.index, index]),
  )

  const patternSentences = drafts.map((draft) => {
    const qualifyingPosition = qualifyingPositions.get(draft.index)
    if (qualifyingPosition === undefined) {
      return scoreSentence(draft, new Map(), new Map(), 0)
    }

    const localDrafts = qualifyingDrafts.slice(
      Math.max(0, qualifyingPosition - 3),
      qualifyingPosition + 4,
    )
    const openingCounts = occurrenceCounts(
      localDrafts.map((sentence) => sentence.openingKey),
    )
    const transitionCounts = occurrenceCounts(
      localDrafts.map((sentence) => sentence.transition?.key),
    )
    const variation = lengthVariation(
      localDrafts.map((sentence) => sentence.wordCount),
    )
    const averageLength =
      localDrafts.reduce((sum, sentence) => sum + sentence.wordCount, 0) /
      Math.max(1, localDrafts.length)
    const uniformLengthImpact =
      localDrafts.length >= 4 && averageLength >= 6 && variation <= 0.22
        ? variation <= 0.1
          ? 14
          : variation <= 0.17
            ? 11
            : 8
        : 0

    return scoreSentence(
      draft,
      openingCounts,
      transitionCounts,
      uniformLengthImpact,
    )
  })

  const sentences = applyStatisticalScores(patternSentences)
  const coverage = makeCoverage(text, sentences)
  const passages =
    coverage.status === 'exact' &&
    coverage.rawPercent >= COVERAGE_REVIEW_THRESHOLD
      ? makeFlaggedPassages(text, sentences)
      : []
  const topSignals = aggregateSignals(
    sentences.filter((sentence) => sentence.qualifies),
  ).slice(0, 5)
  const score = coverage.rawPercent
  const classification = classifyCoverage(score)
  const patternIntensity = weightedPatternScore(sentences)
  const confidence = makeConfidence(
    coverage.qualifyingWordCount,
    coverage.qualifyingSentenceCount,
  )

  return {
    score,
    coverage,
    patternIntensity,
    classification,
    confidence,
    summary: makeSummary(coverage, confidence),
    sentences,
    flaggedPassages: passages,
    topSignals,
    stats: makeStats(text, sentences, passages, coverage),
    coaching: makeCoaching(topSignals),
    methodology: {
      ...METHODOLOGY,
      profileId: `${CALIBRATION_PROFILE.id}@${CALIBRATION_PROFILE.version}`,
      thresholds: { ...METHODOLOGY.thresholds },
      heuristics: [...METHODOLOGY.heuristics],
    },
    limitations: [...LIMITATIONS],
  }
}

export type {
  AnalysisConfidence,
  AnalysisMethodology,
  AnalysisResult,
  AnalysisStats,
  Classification,
  ConfidenceLevel,
  CoverageResult,
  ExclusionReason,
  FlaggedPassage,
  RevisionCoaching,
  SentenceAnalysis,
  SignalId,
  ScoreStatus,
  TopSignal,
  WritingSignal,
} from './types'
