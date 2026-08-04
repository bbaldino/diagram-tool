import { describe, it, expect } from 'vitest'
import { SCHEMES, secondaryText, resolveScheme, accentFill, type Scheme } from './schemes'

const MIN_CONTRAST = 4.5 // WCAG AA for normal text

function rgb(hex: string): [number, number, number] {
  const n = hex.slice(1)
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const entries = Object.entries(SCHEMES) as [string, Scheme][]

const MIN_TONE_GAP = 60 // sum of per-channel deltas; 95%-toward-bg scored 24

describe('scheme contrast', () => {
  it.each(entries)('%s: primary text clears AA on its own background', (_name, s) => {
    expect(contrast(s.text, s.background)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it.each(entries)('%s: secondary text clears AA on its own background', (_name, s) => {
    expect(contrast(secondaryText(s), s.background)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it.each(entries)('%s: secondary text is visibly lighter than primary', (_name, s) => {
    const [pr, pg, pb] = rgb(s.text)
    const [sr, sg, sb] = rgb(secondaryText(s))
    const gap = Math.abs(sr - pr) + Math.abs(sg - pg) + Math.abs(sb - pb)
    expect(gap).toBeGreaterThanOrEqual(MIN_TONE_GAP)
  })

  it('accentFill mixes the border toward the background', () => {
    expect(accentFill(SCHEMES.paper)).toBe('#edf0f5')
  })

  // Not asserted here: secondaryText against accentFill. It fails for 9 of the
  // 13 schemes (4.13–4.49) — correctly, since secondaryText never renders on
  // an accent background. --scheme-text-2 is used only by .node__sub and
  // .node__field-k, both of which sit on --scheme-bg, not --scheme-accent.
  it.each(entries)('%s: primary text clears AA on the accent fill', (_name, s) => {
    expect(contrast(s.text, accentFill(s))).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })
})

describe('resolveScheme', () => {
  it.each(['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty'])(
    'falls back for the inherited key %s rather than returning a prototype member',
    (key) => {
      expect(resolveScheme(key, 'paper')).toEqual(SCHEMES.paper)
    },
  )

  it('resolves a known name', () => {
    expect(resolveScheme('blue', 'paper')).toEqual(SCHEMES.blue)
  })

  it('derives a scheme from a custom hex', () => {
    expect(resolveScheme('#7c3aed', 'paper').background).toBe('#ebe1fc')
  })
})
