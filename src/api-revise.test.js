import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from '../api/revise.js'

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('optional contextual revision endpoint', () => {
  it('reports whether the provider is configured without receiving text', async () => {
    const response = mockResponse()
    await handler({ method: 'GET' }, response)
    expect(response.body).toEqual({ available: false })
  })

  it('fails closed when no provider key is configured', async () => {
    const response = mockResponse()
    await handler(
      {
        method: 'POST',
        body: { passage: 'A sufficiently long passage for review.', intent: 'clarify' },
      },
      response,
    )
    expect(response.statusCode).toBe(503)
    expect(response.body.error).toMatch(/not configured/i)
  })

  it('requests a non-stored structured revision with detector-evasion guardrails', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('CONTEXTUAL_REVISION_ENABLED', 'true')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          revisedText: 'The clinic reviewed 48 records.',
          summary: 'Clarified the action.',
          preservedFacts: ['48'],
          warnings: [],
        }),
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = mockResponse()

    await handler(
      {
        method: 'POST',
        body: {
          passage: 'The clinic conducted an analysis of 48 records.',
          intent: 'clarify',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body.revisedText).toContain('48')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request.store).toBe(false)
    expect(request.instructions).toMatch(/Do not optimize for/i)
    expect(request.text.format.type).toBe('json_schema')
  })
})
