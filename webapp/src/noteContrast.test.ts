import { describe, it, expect } from 'vitest'
import { PALETTE } from './ColorPicker'

// These percentages must match the color-mix() calls in index.css for
// .note--tinted (background) and .note--tinted textarea/.note__md/.note__placeholder
// (text). Keep them in sync by eye whenever the CSS changes.
const BACKGROUND_MIX_PERCENT = 15 // color-mix(in srgb, var(--note-color) 15%, white)
const TEXT_MIX_PERCENT = 60 // color-mix(in srgb, var(--note-color) TEXT_MIX_PERCENT%, black)

const MIN_CONTRAST = 4.5 // WCAG AA for normal text

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return [r, g, b]
}

// color-mix(in srgb, A p%, B) is per-channel linear interpolation:
// result = A * p + B * (1 - p)
function colorMix(a: Rgb, percentA: number, b: Rgb): Rgb {
  const p = percentA / 100
  return [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)]
}

function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

describe('tinted note text contrast', () => {
  it.each(PALETTE)('reaches WCAG AA contrast (>= 4.5:1) for %s', (hex) => {
    const base = hexToRgb(hex)
    const background = colorMix(base, BACKGROUND_MIX_PERCENT, WHITE)
    const text = colorMix(base, TEXT_MIX_PERCENT, BLACK)
    const ratio = contrastRatio(background, text)
    expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })
})
