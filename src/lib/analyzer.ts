import type {
  AnalysisConfidence,
  AnalysisMethodology,
  AnalysisResult,
  AnalysisStats,
  Classification,
  FlaggedPassage,
  RevisionCoaching,
  SentenceAnalysis,
  SignalId,
  TopSignal,
  WritingSignal,
} from './types'

const MIXED_THRESHOLD = 40
const HIGH_THRESHOLD = 65

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
  name: 'DraftLens writing-pattern heuristic',
  version: '1.0',
  kind: 'deterministic-writing-pattern-heuristic',
  description:
    'A local, rule-based review of visible writing patterns. The same text always produces the same result.',
  scoreMeaning:
    'The 0-100 score indicates how strongly this draft matches the listed writing patterns. It is not a probability that AI wrote the text.',
  thresholds: {
    low: '0-39: few of the tracked patterns',
    mixed: '40-64: a noticeable concentration of tracked patterns',
    high: '65-100: a strong concentration of tracked patterns',
  },
  heuristics: [
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
  'This score cannot establish authorship or prove that text was written by AI or by a person.',
  'Formal, technical, translated, template-based, or heavily edited human writing may trigger the same patterns.',
  'Short samples produce less reliable pattern counts; use the separate confidence rating when interpreting the score.',
  'The analyzer uses fixed rules rather than a trained model or proprietary comparison corpus.',
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
  openingKey?: string
  openingEvidence?: string
  transition?: TransitionMatch
  stockEvidence: string[]
  abstractEvidence: string[]
  nominalizationEvidence: string[]
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function classify(score: number): Classification {
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

function makeSentenceDraft(span: SentenceSpan, index: number): SentenceDraft {
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

  return {
    ...span,
    index,
    words,
    wordCount: words.length,
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
    score,
    classification: classify(score),
    signals,
  }
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

function makeFlaggedPassages(
  text: string,
  sentences: SentenceAnalysis[],
): FlaggedPassage[] {
  const groups: SentenceAnalysis[][] = []
  let current: SentenceAnalysis[] = []

  sentences.forEach((sentence) => {
    if (sentence.classification !== 'low') {
      current.push(sentence)
      return
    }

    if (current.length > 0) groups.push(current)
    current = []
  })
  if (current.length > 0) groups.push(current)

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
      classification: score >= HIGH_THRESHOLD ? 'high' : 'mixed',
      sentenceIds: group.map((sentence) => sentence.id),
      signals: aggregateSignals(group).slice(0, 4),
    }
  })
}

function makeConfidence(
  wordCount: number,
  sentenceCount: number,
): AnalysisConfidence {
  const score = clampScore(
    Math.min(70, (wordCount / 200) * 70) +
      Math.min(30, (sentenceCount / 8) * 30),
  )

  if (wordCount === 0) {
    return {
      level: 'low',
      score: 0,
      label: 'No sample',
      reason: 'Add report text before interpreting a writing-pattern score.',
    }
  }

  if (wordCount < 75 || sentenceCount < 3) {
    return {
      level: 'low',
      score,
      label: 'Low confidence',
      reason: `Only ${wordCount} words across ${sentenceCount} sentence${sentenceCount === 1 ? '' : 's'} were available; treat the score as especially tentative.`,
    }
  }

  if (wordCount < 200 || sentenceCount < 8) {
    return {
      level: 'medium',
      score,
      label: 'Medium confidence',
      reason: `${wordCount} words across ${sentenceCount} sentences reveal some patterns, but a broader sample would stabilize repetition and rhythm measures.`,
    }
  }

  return {
    level: 'high',
    score,
    label: 'Higher confidence',
    reason: `${wordCount} words across ${sentenceCount} sentences provide enough material to compare repeated wording and sentence-length patterns.`,
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
  score: number,
  classification: Classification,
  confidence: AnalysisConfidence,
): string {
  if (confidence.score === 0) {
    return 'Add report text to review its writing patterns.'
  }

  const concentration =
    classification === 'high'
      ? 'a strong concentration'
      : classification === 'mixed'
        ? 'a noticeable concentration'
        : 'few'

  return `${score}/100 indicates ${concentration} of the tracked writing patterns. This is a ${confidence.level}-confidence writing aid, not proof of AI authorship.`
}

function makeStats(
  text: string,
  sentences: SentenceAnalysis[],
  passages: FlaggedPassage[],
): AnalysisStats {
  const allWords = wordsIn(text)
  const normalizedWords = allWords.map((word) => word.toLowerCase())
  const trimmed = text.trim()
  const paragraphCount = trimmed
    ? trimmed.split(/\r?\n\s*\r?\n+/u).filter((paragraph) => /\S/u.test(paragraph))
        .length
    : 0
  const averageSentenceLength =
    sentences.length === 0 ? 0 : allWords.length / sentences.length

  return {
    characterCount: trimmed.length,
    wordCount: allWords.length,
    sentenceCount: sentences.length,
    paragraphCount,
    averageSentenceLength: Math.round(averageSentenceLength * 10) / 10,
    sentenceLengthVariation: Math.round(
      lengthVariation(sentences.map((sentence) => sentence.wordCount)) * 100,
    ),
    flaggedSentenceCount: sentences.filter(
      (sentence) => sentence.classification !== 'low',
    ).length,
    flaggedPassageCount: passages.length,
    uniqueWordRatio:
      allWords.length === 0
        ? 0
        : Math.round((new Set(normalizedWords).size / allWords.length) * 100),
  }
}

/**
 * Produces a deterministic, explainable writing-pattern estimate.
 * It does not call an AI model, determine authorship, or reproduce Turnitin.
 */
export function analyzeText(text: string): AnalysisResult {
  const drafts = splitSentences(text).map(makeSentenceDraft)
  const openingCounts = occurrenceCounts(
    drafts.map((sentence) => sentence.openingKey),
  )
  const transitionCounts = occurrenceCounts(
    drafts.map((sentence) => sentence.transition?.key),
  )
  const variation = lengthVariation(drafts.map((sentence) => sentence.wordCount))
  const averageLength =
    drafts.length === 0
      ? 0
      : drafts.reduce((sum, sentence) => sum + sentence.wordCount, 0) /
        drafts.length
  const uniformLengthImpact =
    drafts.length >= 4 && averageLength >= 6 && variation <= 0.22
      ? variation <= 0.1
        ? 14
        : variation <= 0.17
          ? 11
          : 8
      : 0

  const sentences = drafts.map((draft) =>
    scoreSentence(
      draft,
      openingCounts,
      transitionCounts,
      uniformLengthImpact,
    ),
  )
  const passages = makeFlaggedPassages(text, sentences)
  const topSignals = aggregateSignals(sentences).slice(0, 5)
  const score = weightedScore(sentences)
  const classification = classify(score)
  const totalWords = wordsIn(text).length
  const confidence = makeConfidence(totalWords, sentences.length)

  return {
    score,
    classification,
    confidence,
    summary: makeSummary(score, classification, confidence),
    sentences,
    flaggedPassages: passages,
    topSignals,
    stats: makeStats(text, sentences, passages),
    coaching: makeCoaching(topSignals),
    methodology: {
      ...METHODOLOGY,
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
  FlaggedPassage,
  RevisionCoaching,
  SentenceAnalysis,
  SignalId,
  TopSignal,
  WritingSignal,
} from './types'
