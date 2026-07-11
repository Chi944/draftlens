export type InputMode = 'upload' | 'paste'

export interface RecoverySnapshot {
  text: string
  sourceName: string
  inputMode: InputMode
  savedAt: number
}

const RECOVERY_KEY = 'draftlens:session-recovery:v1'
const MAX_RECOVERY_CHARACTERS = 500_000
const RECOVERY_TTL_MS = 8 * 60 * 60 * 1_000

export function saveRecoverySnapshot(
  snapshot: Omit<RecoverySnapshot, 'savedAt'>,
): boolean {
  if (
    typeof sessionStorage === 'undefined' ||
    snapshot.text.length > MAX_RECOVERY_CHARACTERS
  ) {
    return false
  }

  try {
    sessionStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({ ...snapshot, savedAt: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

export function loadRecoverySnapshot(): RecoverySnapshot | null {
  if (typeof sessionStorage === 'undefined') return null

  try {
    const stored = sessionStorage.getItem(RECOVERY_KEY)
    if (!stored) return null
    const value = JSON.parse(stored) as Partial<RecoverySnapshot>
    if (
      typeof value.text !== 'string' ||
      typeof value.sourceName !== 'string' ||
      (value.inputMode !== 'upload' && value.inputMode !== 'paste') ||
      typeof value.savedAt !== 'number' ||
      Date.now() - value.savedAt > RECOVERY_TTL_MS ||
      value.savedAt > Date.now() + 60_000
    ) {
      clearRecoverySnapshot()
      return null
    }
    return value as RecoverySnapshot
  } catch {
    clearRecoverySnapshot()
    return null
  }
}

export function clearRecoverySnapshot(): void {
  try {
    sessionStorage?.removeItem(RECOVERY_KEY)
  } catch {
    // Recovery is a convenience; storage failures must not block the review.
  }
}
