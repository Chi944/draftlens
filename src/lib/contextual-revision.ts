export type ContextualRevisionIntent =
  | 'clarify'
  | 'shorten'
  | 'strengthen-reasoning'

export interface ContextualRevisionResult {
  revisedText: string
  summary: string
  preservedFacts: string[]
  warnings: string[]
}

export async function getContextualRevisionAvailability(
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await fetch('/api/revise', { signal })
  const payload = (await response.json().catch(() => null)) as
    | { available?: boolean }
    | null

  return response.ok && payload?.available === true
}

export async function requestContextualRevision(
  passage: string,
  intent: ContextualRevisionIntent,
  signal?: AbortSignal,
): Promise<ContextualRevisionResult> {
  const response = await fetch('/api/revise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passage, intent }),
    signal,
  })

  const payload = (await response.json().catch(() => null)) as
    | (Partial<ContextualRevisionResult> & { error?: string })
    | null
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Contextual revision is unavailable.')
  }
  if (
    !payload ||
    typeof payload.revisedText !== 'string' ||
    typeof payload.summary !== 'string' ||
    !Array.isArray(payload.preservedFacts) ||
    !Array.isArray(payload.warnings)
  ) {
    throw new Error('The contextual revision response was incomplete.')
  }

  return payload as ContextualRevisionResult
}
