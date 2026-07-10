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
  passageId: string
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
  'DraftLens makes conservative clarity edits and never invents facts, sources, quotations, or personal experience. Review every change before applying it.'

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

const RULES: RevisionRule[] = [
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

function passageForSentence(
  sentence: SentenceAnalysis,
  passages: FlaggedPassage[],
): FlaggedPassage | undefined {
  return passages.find((passage) => passage.sentenceIds.includes(sentence.id))
}

function sentenceContainsQuotation(text: string): boolean {
  return /["“”]/u.test(text)
}

function reviseSentence(sentence: SentenceAnalysis): {
  text: string
  ruleIds: RevisionRuleId[]
} {
  if (
    sentenceContainsQuotation(sentence.text) ||
    !sentence.signals.some((signal) => signal.id === 'stock-phrases')
  ) {
    return { text: sentence.text, ruleIds: [] }
  }

  let text = sentence.text
  const ruleIds: RevisionRuleId[] = []

  RULES.forEach((rule) => {
    const revised = text.replace(rule.pattern, rule.replacement)
    if (revised !== text) {
      text = revised
      ruleIds.push(rule.id)
    }
  })

  if (text && /^\p{Ll}/u.test(text)) {
    text = `${text[0].toUpperCase()}${text.slice(1)}`
  }

  return { text, ruleIds }
}

function stalePlan(text: string, passageCount: number): RevisionPlan {
  return {
    status: 'stale-audit',
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

function unavailablePlan(text: string): RevisionPlan {
  return {
    status: 'unavailable',
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
): RevisionPlan {
  if (audit.coverage.status !== 'exact' || audit.flaggedPassages.length === 0) {
    return unavailablePlan(text)
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
      return stalePlan(text, orderedPassages.length)
    }
  }

  const edits: ProposedRevision[] = []
  const guidanceIds = new Set<SignalId>()

  orderedPassages.forEach((passage) => {
    passage.signals.forEach((signal) => guidanceIds.add(signal.id))
  })

  audit.sentences.forEach((sentence) => {
    const passage = passageForSentence(sentence, orderedPassages)
    if (!passage) return
    if (text.slice(sentence.start, sentence.end) !== sentence.text) {
      return
    }

    const revised = reviseSentence(sentence)
    if (revised.text === sentence.text) return

    edits.push({
      id: `revision-${sentence.id}`,
      passageId: passage.id,
      sentenceId: sentence.id,
      ruleIds: revised.ruleIds,
      start: sentence.start,
      end: sentence.end,
      before: sentence.text,
      after: revised.text,
      rationale:
        'Compressed sentence-opening boilerplate while retaining the original claim and qualifiers.',
    })
  })

  const hasStaleSentence = audit.sentences.some((sentence) => {
    const passage = passageForSentence(sentence, orderedPassages)
    return (
      passage !== undefined &&
      text.slice(sentence.start, sentence.end) !== sentence.text
    )
  })
  if (hasStaleSentence) return stalePlan(text, orderedPassages.length)

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
