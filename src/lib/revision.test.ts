import { describe, expect, it } from 'vitest'

import {
  applyAuditRevisionDraft,
  planAuditRevisions,
  type RevisionAudit,
} from './revision'
import type {
  FlaggedPassage,
  SentenceAnalysis,
  SignalId,
  TopSignal,
  WritingSignal,
} from './types'

function writingSignal(id: SignalId): WritingSignal {
  return {
    id,
    label: id,
    description: `${id} description`,
    impact: 20,
    evidence: [id],
  }
}

function topSignal(id: SignalId, sentenceCount: number): TopSignal {
  return {
    id,
    label: id,
    description: `${id} description`,
    affectedSentenceCount: sentenceCount,
    occurrenceCount: sentenceCount,
    totalImpact: sentenceCount * 20,
    evidence: [id],
  }
}

function makeAudit(
  text: string,
  sentenceTexts: string[],
  signalIds: SignalId[],
  flaggedSentenceIndexes = sentenceTexts.map((_, index) => index),
): RevisionAudit {
  let cursor = 0
  const sentences: SentenceAnalysis[] = sentenceTexts.map(
    (sentenceText, index) => {
      const start = text.indexOf(sentenceText, cursor)
      const end = start + sentenceText.length
      cursor = end
      const flagged = flaggedSentenceIndexes.includes(index)
      return {
        id: `sentence-${index + 1}`,
        index,
        text: sentenceText,
        start,
        end,
        wordCount: sentenceText.split(/\s+/u).length,
        qualifies: true,
        likelihood: flagged ? 98 : 12,
        detected: flagged,
        patternScore: flagged ? 80 : 10,
        score: flagged ? 98 : 12,
        classification: flagged ? 'high' : 'low',
        signals: flagged ? signalIds.map(writingSignal) : [],
      }
    },
  )
  const flaggedSentences = sentences.filter((sentence) =>
    flaggedSentenceIndexes.includes(sentence.index),
  )
  const passageStart = flaggedSentences[0]?.start ?? 0
  const passageEnd = flaggedSentences.at(-1)?.end ?? 0
  const passage: FlaggedPassage = {
    id: 'passage-1',
    start: passageStart,
    end: passageEnd,
    text: text.slice(passageStart, passageEnd),
    score: 98,
    classification: 'high',
    sentenceIds: flaggedSentences.map((sentence) => sentence.id),
    signals: signalIds.map((id) => topSignal(id, flaggedSentences.length)),
  }

  return {
    coverage: {
      rawPercent: 80,
      displayedPercent: 80,
      displayLabel: '80%',
      status: 'exact',
      qualifyingWordCount: 320,
      detectedWordCount: 256,
      excludedWordCount: 0,
      qualifyingSentenceCount: sentences.length,
      detectedSentenceCount: flaggedSentences.length,
    },
    sentences,
    flaggedPassages: flaggedSentences.length > 0 ? [passage] : [],
  }
}

describe('audit-guided revision planning', () => {
  it('compresses only conservative sentence-opening stock frames', () => {
    const sentences = [
      'It is important to note that the trial ended on Tuesday.',
      'It should be noted that costs rose by 4%.',
      'In conclusion, it is evident that three teams withdrew.',
    ]
    const text = sentences.join(' ')
    const plan = planAuditRevisions(
      text,
      makeAudit(text, sentences, ['stock-phrases']),
    )

    expect(plan.status).toBe('ready')
    expect(plan.previewText).toBe(
      'Importantly, the trial ended on Tuesday. Note that costs rose by 4%. Evidently, three teams withdrew.',
    )
    expect(plan.edits).toHaveLength(3)
    expect(plan.previewText).toContain('4%')
  })

  it('leaves quotations and matching wording outside flagged passages unchanged', () => {
    const sentences = [
      '"It is important to note that the quoted claim stays exact."',
      'It is clear that the flagged claim is supported.',
      'It is clear that the unflagged claim stays unchanged.',
    ]
    const text = sentences.join(' ')
    const plan = planAuditRevisions(
      text,
      makeAudit(text, sentences, ['stock-phrases'], [0, 1]),
    )

    expect(plan.edits).toHaveLength(1)
    expect(plan.previewText).toBe(
      '"It is important to note that the quoted claim stays exact." Clearly, the flagged claim is supported. It is clear that the unflagged claim stays unchanged.',
    )
  })

  it('uses guidance instead of fabricating specificity or actors', () => {
    const sentence = 'The implementation of the framework improved outcomes.'
    const plan = planAuditRevisions(
      sentence,
      makeAudit(sentence, [sentence], [
        'abstract-language',
        'nominalized-language',
        'low-specificity',
        'statistical-pattern',
      ]),
    )

    expect(plan.status).toBe('no-safe-edits')
    expect(plan.previewText).toBe(sentence)
    expect(plan.guidance.map((item) => item.signalId)).toEqual([
      'abstract-language',
      'low-specificity',
      'nominalized-language',
      'statistical-pattern',
    ])
    expect(plan.previewText).not.toContain('[')
  })

  it('preserves UTF-16 offsets and all unflagged surrounding text', () => {
    const prefix = '🧪 Field note. '
    const sentence = 'It is apparent that Batch C17 arrived on 14 March.'
    const suffix = ' Reference: https://example.test/C17.'
    const text = `${prefix}${sentence}${suffix}`
    const plan = planAuditRevisions(
      text,
      makeAudit(text, [sentence], ['stock-phrases']),
    )

    expect(plan.previewText).toBe(
      `${prefix}Apparently, Batch C17 arrived on 14 March.${suffix}`,
    )
  })

  it('fails closed when the audit or apply source is stale', () => {
    const sentence = 'It is clear that the trial ended.'
    const audit = makeAudit(sentence, [sentence], ['stock-phrases'])
    const stalePlan = planAuditRevisions(`Changed ${sentence}`, audit)

    expect(stalePlan.status).toBe('stale-audit')
    expect(stalePlan.previewText).toBe(`Changed ${sentence}`)

    const plan = planAuditRevisions(sentence, audit)
    expect(
      applyAuditRevisionDraft(`Changed ${sentence}`, plan, plan.previewText),
    ).toEqual({ status: 'stale-plan', text: `Changed ${sentence}` })
  })

  it('does not expose targeted revisions without reportable highlights', () => {
    const sentence = 'It is clear that the trial ended.'
    const audit = makeAudit(sentence, [sentence], ['stock-phrases'])
    audit.coverage.status = 'below-reporting-threshold'
    audit.coverage.displayedPercent = null
    audit.coverage.displayLabel = '*%'
    audit.flaggedPassages = []

    const plan = planAuditRevisions(sentence, audit)

    expect(plan.status).toBe('unavailable')
    expect(plan.edits).toHaveLength(0)
    expect(plan.previewText).toBe(sentence)
  })
})
