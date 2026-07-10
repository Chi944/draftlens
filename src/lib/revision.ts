import type {
  AnalysisResult,
  FlaggedPassage,
  SentenceAnalysis,
  SignalId,
} from './types'

export type RevisionRuleId =
  | 'remove-conclusion-signpost'
  | 'compress-important-note'
  | 'compress-passive-note'
  | 'compress-clear-frame'
  | 'compress-evident-frame'
  | 'compress-apparent-frame'
  | 'compress-transitioned-note'
  | 'remove-repeated-additive-transition'
  | 'shorten-in-order-to'
  | 'shorten-due-to-fact'
  | 'shorten-despite-fact'
  | 'shorten-event-that'
  | 'shorten-current-time'
  | 'shorten-frequency-basis'
  | 'remove-total-before-number'
  | 'shorten-majority'
  | 'simplify-impact'
  | 'simplify-assistance'
  | 'simplify-consideration'
  | 'simplify-use'
  | 'simplify-decision'
  | 'simplify-analysis'
  | 'simplify-assessment'
  | 'simplify-evaluation'
  | 'simplify-conclusion'
  | 'simplify-observation'
  | 'simplify-indication'
  | 'simplify-utilization'
  | 'remove-redundant-word-pair'

export type RevisionMode = 'conservative' | 'comprehensive'

export type RevisionStatus =
  | 'ready'
  | 'no-safe-edits'
  | 'unavailable'
  | 'stale-audit'

export type RevisionAudit = Pick<
  AnalysisResult,
  'coverage' | 'sentences' | 'flaggedPassages'
>

export interface ProposedRevision {
  id: string
  passageId: string | null
  sentenceId: string
  ruleIds: RevisionRuleId[]
  start: number
  end: number
  before: string
  after: string
  rationale: string
}

export interface RevisionGuidance {
  signalId: SignalId
  title: string
  instruction: string
}

export interface RevisionPlan {
  status: RevisionStatus
  mode: RevisionMode
  sourceText: string
  previewText: string
  passageCount: number
  edits: ProposedRevision[]
  guidance: RevisionGuidance[]
  warnings: string[]
}

export interface AppliedRevisionDraft {
  status: 'applied' | 'stale-plan'
  text: string
}

const REVISION_WARNING =
  'DraftLens never invents facts, sources, quotations, names, numbers, or personal experience. Comprehensive edits tighten supported wording; evidence-dependent changes remain prompts. Review every change before applying it.'

const GUIDANCE: Record<SignalId, Omit<RevisionGuidance, 'signalId'>> = {
  'stock-phrases': {
    title: 'State the verified claim directly',
    instruction:
      'Remove framing only when it adds no meaning. Keep every qualifier and preserve the underlying claim.',
  },
  'repetitive-openings': {
    title: 'Vary the entry point with supported information',
    instruction:
      'Lead with an actor, event, or finding already present in the draft. Do not introduce a new actor simply to vary the rhythm.',
  },
  'uniform-sentence-length': {
    title: 'Let sentence shape follow the reasoning',
    instruction:
      'Split a sentence only where it contains two complete existing claims, or combine closely related support without dropping a qualifier.',
  },
  'repeated-transitions': {
    title: 'Keep logical links, remove repeated signposting',
    instruction:
      'Retain contrast and causal words when they carry meaning. Remove a transition only when the relationship is already clear.',
  },
  'abstract-language': {
    title: 'Ground broad terms in verified evidence',
    instruction:
      'Name the actor, action, setting, or outcome only when it is supported by notes or sources.',
  },
  'nominalized-language': {
    title: 'Put a supported actor back into the sentence',
    instruction:
      'Turn a noun into a verb only when the responsible person or organization is already established by the document.',
  },
  'low-specificity': {
    title: 'Add only details you can verify',
    instruction:
      'Use names, dates, quantities, quotations, or observations from reliable notes and sources. Leave the claim general if the evidence is unavailable.',
  },
  'statistical-pattern': {
    title: 'Compare the wording with the writer\'s process',
    instruction:
      'Check notes, sources, and earlier drafts. Revise only language that does not accurately reflect the writer\'s reasoning.',
  },
}

interface RevisionRule {
  id: RevisionRuleId
  pattern: RegExp
  replacement: string
}

function literalRules(
  id: RevisionRuleId,
  replacements: ReadonlyArray<readonly [before: string, after: string]>,
): RevisionRule[] {
  return replacements.map(([before, after]) => ({
    id,
    pattern: new RegExp(
      `\\b${before.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`,
      'giu',
    ),
    replacement: after,
  }))
}

const OPENING_RULES: RevisionRule[] = [
  {
    id: 'remove-conclusion-signpost',
    pattern: /^In conclusion,\s+/iu,
    replacement: '',
  },
  {
    id: 'compress-important-note',
    pattern:
      /^It (?:is|remains) important to (?:note|recognize|understand) that\s+/iu,
    replacement: 'Importantly, ',
  },
  {
    id: 'compress-passive-note',
    pattern: /^It should be noted that\s+/iu,
    replacement: 'Note that ',
  },
  {
    id: 'compress-clear-frame',
    pattern: /^It is clear that\s+/iu,
    replacement: 'Clearly, ',
  },
  {
    id: 'compress-evident-frame',
    pattern: /^It is evident that\s+/iu,
    replacement: 'Evidently, ',
  },
  {
    id: 'compress-apparent-frame',
    pattern: /^It is apparent that\s+/iu,
    replacement: 'Apparently, ',
  },
]

const COMPREHENSIVE_RULES: RevisionRule[] = [
  ...literalRules('shorten-in-order-to', [['in order to', 'to']]),
  ...literalRules('shorten-due-to-fact', [
    ['due to the fact that', 'because'],
  ]),
  ...literalRules('shorten-despite-fact', [
    ['despite the fact that', 'although'],
  ]),
  ...literalRules('shorten-event-that', [['in the event that', 'if']]),
  ...literalRules('shorten-current-time', [
    ['at this point in time', 'now'],
    ['at the present time', 'now'],
  ]),
  ...literalRules('shorten-frequency-basis', [
    ['on a daily basis', 'daily'],
    ['on a weekly basis', 'weekly'],
    ['on a monthly basis', 'monthly'],
    ['on an annual basis', 'annually'],
  ]),
  {
    id: 'remove-total-before-number',
    pattern: /\ba total of (?=(?:[$€£]\s*)?\p{N})/giu,
    replacement: '',
  },
  ...literalRules('shorten-majority', [['the majority of', 'most']]),
  ...literalRules('simplify-use', [
    ['make use of', 'use'],
    ['makes use of', 'uses'],
    ['made use of', 'used'],
    ['making use of', 'using'],
  ]),
  ...literalRules('simplify-decision', [
    ['make a decision to', 'decide to'],
    ['makes a decision to', 'decides to'],
    ['made a decision to', 'decided to'],
    ['making a decision to', 'deciding to'],
  ]),
  ...literalRules('simplify-analysis', [
    ['conduct an analysis of', 'analyze'],
    ['conducts an analysis of', 'analyzes'],
    ['conducted an analysis of', 'analyzed'],
    ['conducting an analysis of', 'analyzing'],
  ]),
  ...literalRules('simplify-assessment', [
    ['perform an assessment of', 'assess'],
    ['performs an assessment of', 'assesses'],
    ['performed an assessment of', 'assessed'],
    ['performing an assessment of', 'assessing'],
  ]),
  ...literalRules('simplify-evaluation', [
    ['carry out an evaluation of', 'evaluate'],
    ['carries out an evaluation of', 'evaluates'],
    ['carried out an evaluation of', 'evaluated'],
    ['carrying out an evaluation of', 'evaluating'],
  ]),
  ...literalRules('simplify-conclusion', [
    ['reach the conclusion that', 'conclude that'],
    ['reaches the conclusion that', 'concludes that'],
    ['reached the conclusion that', 'concluded that'],
  ]),
  ...literalRules('simplify-observation', [
    ['make an observation that', 'observe that'],
    ['makes an observation that', 'observes that'],
    ['made an observation that', 'observed that'],
  ]),
  ...literalRules('simplify-indication', [
    ['provide an indication that', 'indicate that'],
    ['provides an indication that', 'indicates that'],
    ['provided an indication that', 'indicated that'],
  ]),
  ...literalRules('simplify-impact', [
    ['has an impact on', 'affects'],
    ['have an impact on', 'affect'],
    ['had an impact on', 'affected'],
  ]),
  ...literalRules('simplify-assistance', [
    ['provide assistance to', 'help'],
    ['provides assistance to', 'helps'],
    ['provided assistance to', 'helped'],
  ]),
  ...literalRules('simplify-consideration', [
    ['take into consideration', 'consider'],
    ['takes into consideration', 'considers'],
    ['took into consideration', 'considered'],
    ['give consideration to', 'consider'],
    ['gives consideration to', 'considers'],
    ['gave consideration to', 'considered'],
  ]),
  ...literalRules('simplify-utilization', [
    ['through the utilization of', 'by using'],
  ]),
  ...literalRules('remove-redundant-word-pair', [
    ['each and every', 'each'],
    ['end result', 'result'],
    ['final outcome', 'result'],
    ['past history', 'history'],
    ['historical past', 'history'],
  ]),
]

const TRANSITIONED_NOTE_PATTERN =
  /^(Moreover|Furthermore|Additionally|In addition),\s+(?:it (?:is|remains) important to (?:note|recognize|understand) that|it should be noted that)\s+/iu

const ADDITIVE_TRANSITION_PATTERN =
  /^(Moreover|Furthermore|Additionally|In addition),\s+/iu

const PROTECTED_FRAGMENT_PATTERN =
  /https?:\/\/[^\s)\]}]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|\b[\p{Lu}]{1,6}\p{N}[\p{L}\p{N}-]*\b|\b\p{N}+(?:[.,]\p{N}+)*(?:%|\p{L}+)?\b|\([^)]*(?:\p{N}{4}|et al\.)[^)]*\)|\[[^\]]*\p{N}[^\]]*\]/gu

function sentenceContainsQuotation(text: string): boolean {
  return /["“”]/u.test(text)
}

function protectedFragments(text: string): string[] {
  return text.match(PROTECTED_FRAGMENT_PATTERN) ?? []
}

function applyRules(
  text: string,
  rules: RevisionRule[],
  ruleIds: RevisionRuleId[],
): string {
  let revisedText = text
  rules.forEach((rule) => {
    const revised = revisedText.replace(rule.pattern, rule.replacement)
    if (revised !== revisedText) {
      revisedText = revised
      ruleIds.push(rule.id)
    }
  })
  return revisedText
}

function reviseSentence(
  sentence: SentenceAnalysis,
  mode: RevisionMode,
  seenAdditiveTransitions: Set<string>,
): {
  text: string
  ruleIds: RevisionRuleId[]
} {
  if (sentenceContainsQuotation(sentence.text)) {
    return { text: sentence.text, ruleIds: [] }
  }

  const hasStockPhrase = sentence.signals.some(
    (signal) => signal.id === 'stock-phrases',
  )
  if (mode === 'conservative' && !hasStockPhrase) {
    return { text: sentence.text, ruleIds: [] }
  }

  let text = sentence.text
  const ruleIds: RevisionRuleId[] = []

  if (mode === 'comprehensive') {
    const withoutTransitionedNote = text.replace(
      TRANSITIONED_NOTE_PATTERN,
      '$1, ',
    )
    if (withoutTransitionedNote !== text) {
      text = withoutTransitionedNote
      ruleIds.push('compress-transitioned-note')
    }

    const transition = text.match(ADDITIVE_TRANSITION_PATTERN)
    if (transition) {
      const transitionKey = transition[1].toLocaleLowerCase()
      const isRepeated = sentence.signals.some(
        (signal) => signal.id === 'repeated-transitions',
      )
      if (isRepeated && seenAdditiveTransitions.has(transitionKey)) {
        text = text.slice(transition[0].length)
        ruleIds.push('remove-repeated-additive-transition')
      } else {
        seenAdditiveTransitions.add(transitionKey)
      }
    }
  }

  if (hasStockPhrase) {
    text = applyRules(text, OPENING_RULES, ruleIds)
  }

  if (mode === 'comprehensive') {
    text = applyRules(text, COMPREHENSIVE_RULES, ruleIds)
  }

  if (text !== sentence.text && text && /^\p{Ll}/u.test(text)) {
    text = `${text[0].toUpperCase()}${text.slice(1)}`
  }

  if (
    protectedFragments(text).join('\u0000') !==
    protectedFragments(sentence.text).join('\u0000')
  ) {
    return { text: sentence.text, ruleIds: [] }
  }

  return { text, ruleIds: [...new Set(ruleIds)] }
}

function stalePlan(
  text: string,
  passageCount: number,
  mode: RevisionMode,
): RevisionPlan {
  return {
    status: 'stale-audit',
    mode,
    sourceText: text,
    previewText: text,
    passageCount,
    edits: [],
    guidance: [],
    warnings: [
      'The document changed after this audit. Run the audit again before drafting revisions.',
    ],
  }
}

function unavailablePlan(text: string, mode: RevisionMode): RevisionPlan {
  return {
    status: 'unavailable',
    mode,
    sourceText: text,
    previewText: text,
    passageCount: 0,
    edits: [],
    guidance: [],
    warnings: [
      'Targeted revisions are available only for reportable passage highlights.',
    ],
  }
}

export function planAuditRevisions(
  text: string,
  audit: RevisionAudit,
  options: { mode?: RevisionMode } = {},
): RevisionPlan {
  const mode = options.mode ?? 'conservative'
  if (audit.coverage.status !== 'exact' || audit.flaggedPassages.length === 0) {
    return unavailablePlan(text, mode)
  }

  const orderedPassages = [...audit.flaggedPassages].sort(
    (left, right) => left.start - right.start,
  )
  for (let index = 0; index < orderedPassages.length; index += 1) {
    const passage = orderedPassages[index]
    const previous = orderedPassages[index - 1]
    if (
      text.slice(passage.start, passage.end) !== passage.text ||
      (previous && previous.end > passage.start)
    ) {
      return stalePlan(text, orderedPassages.length, mode)
    }
  }

  const edits: ProposedRevision[] = []
  const guidanceIds = new Set<SignalId>()
  const passageBySentenceId = new Map<string, FlaggedPassage>()

  orderedPassages.forEach((passage) => {
    passage.signals.forEach((signal) => guidanceIds.add(signal.id))
    passage.sentenceIds.forEach((sentenceId) => {
      passageBySentenceId.set(sentenceId, passage)
    })
  })

  const targetSentences = audit.sentences.filter((sentence) =>
    mode === 'comprehensive'
      ? sentence.qualifies
      : passageBySentenceId.has(sentence.id),
  )
  const hasStaleSentence = targetSentences.some(
    (sentence) => text.slice(sentence.start, sentence.end) !== sentence.text,
  )
  if (hasStaleSentence) {
    return stalePlan(text, orderedPassages.length, mode)
  }

  const seenAdditiveTransitions = new Set<string>()
  let previousSentenceEnd: number | null = null
  targetSentences.forEach((sentence) => {
    if (
      previousSentenceEnd !== null &&
      /\n\s*\n/u.test(text.slice(previousSentenceEnd, sentence.start))
    ) {
      seenAdditiveTransitions.clear()
    }
    previousSentenceEnd = sentence.end

    const revised = reviseSentence(
      sentence,
      mode,
      seenAdditiveTransitions,
    )
    if (revised.text === sentence.text) return

    const passage = passageBySentenceId.get(sentence.id) ?? null
    const isComprehensiveEdit = revised.ruleIds.some(
      (ruleId) => !OPENING_RULES.some((rule) => rule.id === ruleId),
    )

    edits.push({
      id: `revision-${sentence.id}`,
      passageId: passage?.id ?? null,
      sentenceId: sentence.id,
      ruleIds: revised.ruleIds,
      start: sentence.start,
      end: sentence.end,
      before: sentence.text,
      after: revised.text,
      rationale: isComprehensiveEdit
        ? 'Tightened redundant or wordy phrasing while preserving the sentence\'s claims and protected details.'
        : 'Compressed sentence-opening boilerplate while retaining the original claim and qualifiers.',
    })
  })

  let previewText = text
  const descendingEdits = [...edits].sort(
    (left, right) => right.start - left.start,
  )
  descendingEdits.forEach((edit) => {
    previewText = `${previewText.slice(0, edit.start)}${edit.after}${previewText.slice(edit.end)}`
  })

  const guidance = [...guidanceIds]
    .sort()
    .map((signalId) => ({ signalId, ...GUIDANCE[signalId] }))

  return {
    status: edits.length > 0 ? 'ready' : 'no-safe-edits',
    mode,
    sourceText: text,
    previewText,
    passageCount: orderedPassages.length,
    edits,
    guidance,
    warnings: [REVISION_WARNING],
  }
}

export function applyAuditRevisionDraft(
  currentText: string,
  plan: RevisionPlan,
  revisedText: string,
): AppliedRevisionDraft {
  if (
    currentText !== plan.sourceText ||
    plan.status === 'stale-audit' ||
    plan.status === 'unavailable'
  ) {
    return { status: 'stale-plan', text: currentText }
  }

  return { status: 'applied', text: revisedText }
}
