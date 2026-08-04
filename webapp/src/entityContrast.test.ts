import { describe, it, expect } from 'vitest'
import { PALETTE } from './ColorPicker'

// These percentages must match the color-mix() calls in index.css for
// .note--tinted (background), .note--tinted .note__md code/pre (code background,
// composited over the note background), and .note--tinted textarea/.note__md/
// .note__placeholder (text). Keep them in sync by eye whenever the CSS changes.
const BACKGROUND_MIX_PERCENT = 15 // color-mix(in srgb, var(--note-color) 15%, white)
const CODE_MIX_PERCENT = 18 // color-mix(in srgb, var(--note-color) 18%, transparent), over the note background
const TEXT_MIX_PERCENT = 55 // color-mix(in srgb, var(--note-color) TEXT_MIX_PERCENT%, black)

// .node--tinted .node__sub and .node__field-k
const NODE_SECONDARY_TEXT_MIX_PERCENT = 45
// .node--tinted .node__icon--placeholder background
const NODE_PLACEHOLDER_MIX_PERCENT = 25

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

describe('tinted entity text contrast', () => {
  // .node--tinted uses the same BACKGROUND_MIX_PERCENT/TEXT_MIX_PERCENT ratios
  // against the same WHITE/BLACK surfaces as .note--tinted, so this case covers
  // the node's primary text (.node__label/.node__field/.node__icon--placeholder
  // text) over the card tint as well — no separate case needed for that pairing.
  it.each(PALETTE)('reaches WCAG AA contrast (>= 4.5:1) for %s on the note background', (hex) => {
    const base = hexToRgb(hex)
    const background = colorMix(base, BACKGROUND_MIX_PERCENT, WHITE)
    const text = colorMix(base, TEXT_MIX_PERCENT, BLACK)
    const ratio = contrastRatio(background, text)
    expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  // .note--tinted .note__md code/pre re-tint to color-mix(in srgb, var(--note-color)
  // 18%, transparent). Per the CSS Color 4 spec, mixing a colour with `transparent`
  // keeps the colour's own RGB channels and only scales alpha, so this paints as an
  // 18%-alpha wash of the note colour OVER the note's already-tinted background —
  // i.e. the same linear-interpolation formula as colorMix(), composited a second
  // time on top of `background` rather than on top of white.
  it.each(PALETTE)(
    'reaches WCAG AA contrast (>= 4.5:1) for %s on the code/pre background',
    (hex) => {
      const base = hexToRgb(hex)
      const background = colorMix(base, BACKGROUND_MIX_PERCENT, WHITE)
      const codeBackground = colorMix(base, CODE_MIX_PERCENT, background)
      const text = colorMix(base, TEXT_MIX_PERCENT, BLACK)
      const ratio = contrastRatio(codeBackground, text)
      expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
    },
  )

  it.each(PALETTE)('reaches AA for %s on node secondary text over the card tint', (hex) => {
    const base = hexToRgb(hex)
    const background = colorMix(base, BACKGROUND_MIX_PERCENT, WHITE)
    const text = colorMix(base, NODE_SECONDARY_TEXT_MIX_PERCENT, BLACK)
    expect(contrastRatio(background, text)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  // .node--tinted .node__icon--placeholder paints an OPAQUE background —
  // color-mix(in srgb, var(--node-color) 25%, white) — so it replaces whatever is
  // behind it rather than compositing over the card tint. This is unlike the
  // code/pre case above, which mixes with `transparent` and therefore genuinely
  // does composite over `background`. The placeholder must be mixed against WHITE.
  it.each(PALETTE)('reaches AA for %s on the icon placeholder', (hex) => {
    const base = hexToRgb(hex)
    const placeholder = colorMix(base, NODE_PLACEHOLDER_MIX_PERCENT, WHITE)
    const text = colorMix(base, TEXT_MIX_PERCENT, BLACK)
    expect(contrastRatio(placeholder, text)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })
})
