// Pure helpers for flow playback (the transport bar). Kept side-effect-free
// and DOM-free so they unit-test under Vitest's node env, mirroring flowState.ts.

// Auto-advance speed multipliers offered by the transport bar's speed chip.
export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const

// Milliseconds a step is shown at 1× before auto-advancing.
export const PLAYBACK_BASE_MS = 2200

// Interval between auto-advances at a given speed multiplier.
export function stepIntervalMs(speed: number): number {
  return Math.round(PLAYBACK_BASE_MS / speed)
}

// Transport sub-label: "Step 2 of 4" or "Step 2 of 4 · <caption>".
// A blank/whitespace-only caption is treated as absent.
export function transportSublabel(
  stepIndex: number,
  stepCount: number,
  caption?: string,
): string {
  const base = `Step ${stepIndex + 1} of ${stepCount}`
  const c = caption?.trim()
  return c ? `${base} · ${c}` : base
}

// Next auto-advance target. `atEnd` is true when the returned index is the
// last step (nothing more to advance to). Clamps out-of-range input.
export function advanceStep(cur: number, stepCount: number): { index: number; atEnd: boolean } {
  const last = Math.max(0, stepCount - 1)
  if (cur >= last) return { index: last, atEnd: true }
  const index = cur + 1
  return { index, atEnd: index >= last }
}

// Scrubber bar fill: played/current bars (index ≤ current) are on; later bars off.
export function isStepPlayed(barIndex: number, currentIndex: number): boolean {
  return barIndex <= currentIndex
}
