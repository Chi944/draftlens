import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getContextualRevisionAvailability,
  requestContextualRevision,
} from './contextual-revision'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('contextual revision client', () => {
  it('checks provider availability without sending document text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getContextualRevisionAvailability()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/revise', {
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requests only the selected passage and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          revisedText: 'The clinic reviewed 48 records.',
          summary: 'Clarified the actor and action.',
          preservedFacts: ['48'],
          warnings: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestContextualRevision(
        'The clinic conducted an analysis of 48 records.',
        'clarify',
      ),
    ).resolves.toMatchObject({ revisedText: 'The clinic reviewed 48 records.' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/revise',
      expect.objectContaining({
        body: JSON.stringify({
          passage: 'The clinic conducted an analysis of 48 records.',
          intent: 'clarify',
        }),
      }),
    )
  })

  it('surfaces a disabled-provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Provider is not configured.' }), {
          status: 503,
        }),
      ),
    )

    await expect(
      requestContextualRevision('Passage text.', 'shorten'),
    ).rejects.toThrow('Provider is not configured.')
  })
})
