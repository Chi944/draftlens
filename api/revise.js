const INTENTS = new Set(['clarify', 'shorten', 'strengthen-reasoning'])
const MAX_PASSAGE_CHARACTERS = 8_000
const MAX_BODY_BYTES = 12_000
const RATE_LIMIT = 6
const RATE_WINDOW_MS = 10 * 60 * 1_000
const requestsByClient = new Map()
let activeRequests = 0

function providerAvailable() {
  return Boolean(
    process.env.OPENAI_API_KEY &&
      process.env.CONTEXTUAL_REVISION_ENABLED === 'true',
  )
}

function clientAddress(request) {
  const forwarded = request.headers?.['x-forwarded-for']
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ||
    request.socket?.remoteAddress ||
    'unknown'
}

function consumeRateLimit(request) {
  const now = Date.now()
  const address = clientAddress(request)
  const recent = (requestsByClient.get(address) ?? []).filter(
    (timestamp) => now - timestamp < RATE_WINDOW_MS,
  )
  if (recent.length >= RATE_LIMIT) return false
  recent.push(now)
  requestsByClient.set(address, recent)
  return true
}

function requestComesFromHost(request) {
  const origin = request.headers?.origin
  const host = request.headers?.host
  if (!origin || !host) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text
  for (const item of response.output ?? []) {
    if (item?.type !== 'message') continue
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text
      }
    }
  }
  return ''
}

export default async function handler(request, response) {
  response.setHeader('cache-control', 'no-store')
  if (request.method === 'GET') {
    return response.status(200).json({
      available: providerAvailable(),
    })
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }
  if (!providerAvailable()) {
    return response.status(503).json({
      error: 'The optional contextual revision provider is not configured.',
    })
  }

  if (!requestComesFromHost(request)) {
    return response.status(403).json({ error: 'Request origin is not allowed.' })
  }
  const contentLength = Number(request.headers?.['content-length'] ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response.status(413).json({ error: 'Revision request is too large.' })
  }
  if (!consumeRateLimit(request) || activeRequests >= 2) {
    response.setHeader('retry-after', '600')
    return response.status(429).json({ error: 'Revision limit reached. Try again later.' })
  }

  const { passage, intent } = request.body ?? {}
  if (
    typeof passage !== 'string' ||
    passage.trim().length < 20 ||
    passage.length > MAX_PASSAGE_CHARACTERS ||
    !INTENTS.has(intent)
  ) {
    return response.status(400).json({ error: 'Invalid revision request.' })
  }

  const upstreamController = new AbortController()
  const upstreamTimeout = setTimeout(() => upstreamController.abort(), 30_000)
  activeRequests += 1
  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_REVISION_MODEL ?? 'gpt-5.4-mini',
        store: false,
        max_output_tokens: 2_000,
        reasoning: { effort: 'low' },
        instructions: [
          'You are a careful academic writing editor.',
          'Revise only for clarity, concision, or stronger reasoning as requested.',
          'Do not optimize for, discuss, or attempt to evade any AI detector.',
          'Do not invent facts, sources, quotations, names, numbers, dates, findings, or personal experience.',
          'Preserve citations, URLs, negations, qualifications, and every verifiable detail exactly unless the user text itself clearly restates it.',
          'Return a reviewable revision and concise warnings when a requested improvement needs evidence that is not present.',
        ].join(' '),
        input: JSON.stringify({ intent, passage }),
        text: {
          format: {
            type: 'json_schema',
            name: 'contextual_revision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                revisedText: { type: 'string' },
                summary: { type: 'string' },
                preservedFacts: {
                  type: 'array',
                  items: { type: 'string' },
                },
                warnings: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: [
                'revisedText',
                'summary',
                'preservedFacts',
                'warnings',
              ],
            },
          },
        },
      }),
      signal: upstreamController.signal,
    })

    const payload = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      return response.status(502).json({
        error: 'The revision provider returned an error.',
      })
    }

    try {
      return response.status(200).json(JSON.parse(extractOutputText(payload)))
    } catch {
      return response.status(502).json({
        error: 'The revision provider returned an invalid response.',
      })
    }
  } catch (cause) {
    return response.status(502).json({
      error:
        cause instanceof DOMException && cause.name === 'AbortError'
          ? 'The revision provider timed out.'
          : 'The revision provider could not be reached.',
    })
  } finally {
    clearTimeout(upstreamTimeout)
    activeRequests -= 1
  }
}
