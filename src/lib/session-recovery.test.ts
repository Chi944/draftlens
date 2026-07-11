import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearRecoverySnapshot,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
} from './session-recovery'

describe('session-only recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a draft without persistent local storage', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    expect(
      saveRecoverySnapshot({
        text: 'Recovered draft.',
        sourceName: 'report.docx',
        inputMode: 'upload',
      }),
    ).toBe(true)

    expect(loadRecoverySnapshot()).toEqual({
      text: 'Recovered draft.',
      sourceName: 'report.docx',
      inputMode: 'upload',
      savedAt: 1234,
    })
    expect(localStorage.length).toBe(0)
  })

  it('clears invalid snapshots and skips oversized drafts', () => {
    sessionStorage.setItem('draftlens:session-recovery:v1', '{bad json')
    expect(loadRecoverySnapshot()).toBeNull()
    expect(
      saveRecoverySnapshot({
        text: 'x'.repeat(500_001),
        sourceName: 'large.txt',
        inputMode: 'paste',
      }),
    ).toBe(false)
    clearRecoverySnapshot()
  })

  it('expires stale tab-recovery snapshots', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    saveRecoverySnapshot({
      text: 'Old draft.',
      sourceName: 'old.txt',
      inputMode: 'paste',
    })
    vi.spyOn(Date, 'now').mockReturnValue(9 * 60 * 60 * 1_000)

    expect(loadRecoverySnapshot()).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
})
