// Pure helpers for the flow step bar. Side-effect- and DOM-free so they
// unit-test under Vitest's node env. (rev 4 removed auto-advance — no speed,
// no timer, no `transportSublabel`; the description now lives in the caption
// card and the bar shows a plain counter.)

// "1 / 4" step counter (1-based) for the step bar and caption-card pill.
export function stepCounterLabel(stepIndex: number, stepCount: number): string {
  return `${stepIndex + 1} / ${stepCount}`
}

// Scrubber bar fill: played/current bars (index ≤ current) are on; later off.
export function isStepPlayed(barIndex: number, currentIndex: number): boolean {
  return barIndex <= currentIndex
}
