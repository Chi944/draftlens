import { describe, expect, it } from 'vitest'

import {
  applyAuditRevisionDraft,
  composeRevisionDraft,
  planAuditRevisions,
  validateProtectedContent,
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
  it('composes a tracked draft from individually accepted edits', () => {
    const sentences = [
      'It is clear that the trial ended.',
      'In conclusion, it is evident that three teams withdrew.',
    ]
    const text = sentences.join(' ')
    const plan = planAuditRevisions(
      text,
      makeAudit(text, sentences, ['stock-phrases']),
    )

    expect(plan.edits).toHaveLength(2)
    expect(composeRevisionDraft(plan, [plan.edits[1].id])).toBe(
      'It is clear that the trial ended. Evidently, three teams withdrew.',
    )
    expect(composeRevisionDraft(plan, [])).toBe(text)
  })

  it('reports removed and newly introduced protected content', () => {
    const source =
      'Priya Nair wrote “Batch C17 may include 48 records” (Nair, 2025).'
    const revised =
      'Priya Nair wrote “Batch C17 includes 49 records” (Nair, 2025).'
    const issues = validateProtectedContent(source, revised)

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '48', change: 'removed' }),
        expect.objectContaining({ value: '49', change: 'added' }),
        expect.objectContaining({ value: 'may', change: 'removed' }),
        expect.objectContaining({ kind: 'quotation', change: 'removed' }),
        expect.objectContaining({ kind: 'quotation', change: 'added' }),
      ]),
    )
    expect(
      validateProtectedContent(source, source),
    ).toHaveLength(0)
  })

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

  it('builds a comprehensive clarity draft while preserving protected facts', () => {
    const sentence =
      'In conclusion, it is evident that the clinic conducted an analysis of 48 records in order to determine whether the 4% threshold still applied (Nair, 2025).'
    const plan = planAuditRevisions(
      sentence,
      makeAudit(sentence, [sentence], [
        'stock-phrases',
        'nominalized-language',
        'statistical-pattern',
      ]),
      { mode: 'comprehensive' },
    )

    expect(plan.mode).toBe('comprehensive')
    expect(plan.previewText).toBe(
      'Evidently, the clinic analyzed 48 records to determine whether the 4% threshold still applied (Nair, 2025).',
    )
    expect(plan.edits[0]?.ruleIds).toEqual([
      'remove-conclusion-signpost',
      'compress-evident-frame',
      'shorten-in-order-to',
      'simplify-analysis',
    ])
    expect(plan.previewText).toContain('48')
    expect(plan.previewText).toContain('4%')
    expect(plan.previewText).toContain('(Nair, 2025)')
  })

  it('scans qualifying prose beyond the highlighted passage in comprehensive mode', () => {
    const sentences = [
      'It is important to note that the review started.',
      'The committee made a decision to meet on a weekly basis.',
    ]
    const text = sentences.join(' ')
    const audit = makeAudit(text, sentences, ['stock-phrases'], [0])

    const conservative = planAuditRevisions(text, audit)
    const comprehensive = planAuditRevisions(text, audit, {
      mode: 'comprehensive',
    })

    expect(conservative.previewText).toContain('made a decision')
    expect(comprehensive.previewText).toBe(
      'Importantly, the review started. The committee decided to meet weekly.',
    )
    expect(comprehensive.edits[1]?.passageId).toBeNull()
  })

  it('removes only repeated additive transitions within the same paragraph', () => {
    const sentences = [
      'Moreover, the first supported claim remains.',
      'Moreover, the second supported claim remains.',
      'Moreover, the new paragraph keeps its opening link.',
    ]
    const text = `${sentences[0]} ${sentences[1]}\n\n${sentences[2]}`
    const plan = planAuditRevisions(
      text,
      makeAudit(text, sentences, ['repeated-transitions']),
      { mode: 'comprehensive' },
    )

    expect(plan.previewText).toBe(
      'Moreover, the first supported claim remains. The second supported claim remains.\n\nMoreover, the new paragraph keeps its opening link.',
    )
  })

  it('leaves quoted wording unchanged during comprehensive revision', () => {
    const sentence =
      'It is clear that Maya wrote “The clinic conducted an analysis of 48 records.” in memo C17.'
    const plan = planAuditRevisions(
      sentence,
      makeAudit(sentence, [sentence], ['stock-phrases']),
      { mode: 'comprehensive' },
    )

    expect(plan.previewText).toBe(sentence)
    expect(plan.edits).toHaveLength(0)
  })
})
