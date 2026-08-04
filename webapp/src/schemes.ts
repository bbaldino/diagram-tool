// A colour is a SCHEME: outline, background and font chosen as one unit. This
// replaces deriving all three from a single hex, which could not express the
// entity defaults (a white background forces the source hex to white, which then
// yields a white border and grey text) and degenerated on pale colours.
//
// There is deliberately NO scheme named 'default'. "Default" is a starting
// value — NEW_NODE_SCHEME / NEW_NOTE_SCHEME below — not a kind of colour.
export interface Scheme {
  background: string
  border: string
  text: string
}

export const SCHEMES = {
  // The two starting schemes, byte-identical to the previous literal defaults.
  paper: { background: '#ffffff', border: '#cbd5e1', text: '#1f2937' },
  sticky: { background: '#fef9c3', border: '#fde047', text: '#713f12' },
  // The former PALETTE, resolved once at authoring time.
  slate: { background: '#e8eaee', border: '#b9c0cb', text: '#232931' },
  red: { background: '#fde3e3', border: '#f8abab', text: '#541818' },
  orange: { background: '#feeadc', border: '#fcc096', text: '#572808' },
  amber: { background: '#fef0da', border: '#fad391', text: '#563704' },
  yellow: { background: '#fcf4da', border: '#f6dd90', text: '#523f03' },
  emerald: { background: '#dbf4ec', border: '#93e0c6', text: '#06412d' },
  teal: { background: '#dcf4f2', border: '#95dfd7', text: '#07403a' },
  blue: { background: '#e2ecfe', border: '#a7c7fb', text: '#152e56' },
  indigo: { background: '#e8e8fd', border: '#b9baf9', text: '#232454' },
  violet: { background: '#eee7fe', border: '#cbb6fb', text: '#312056' },
  pink: { background: '#fce4f0', border: '#f6add1', text: '#531936' },
} as const satisfies Record<string, Scheme>

export type SchemeName = keyof typeof SCHEMES

export const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[]

const NAME_SET = new Set<string>(SCHEME_NAMES)

// Own keys only — `value in SCHEMES` and `SCHEMES[value]` are both truthy for
// Object.prototype members, which would resolve a scheme to a Function.
export function isSchemeName(value: string): value is SchemeName {
  return NAME_SET.has(value)
}

export function isCustomHex(value: string): boolean {
  return HEX.test(value)
}

// The ONLY place "default" exists: which scheme a new entity starts with.
export const NEW_NODE_SCHEME: SchemeName = 'paper'
export const NEW_NOTE_SCHEME: SchemeName = 'sticky'

const HEX = /^#[0-9a-fA-F]{6}$/

function rgb(hex: string): [number, number, number] {
  const n = hex.slice(1)
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

function toHex([r, g, b]: [number, number, number]): string {
  const p = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`
}

// Per-channel linear interpolation — the same maths color-mix(in srgb, …) used.
function mix(a: [number, number, number], pct: number, b: [number, number, number]) {
  const p = pct / 100
  return toHex([a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)])
}

const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]

// WCAG relative luminance / contrast ratio. Deliberately independent of the
// copy in entityContrast.test.ts, so that test can catch a bug in this one.
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// A custom hex derives a scheme using the ratios the old renderer used, so a
// custom colour looks exactly as it did before this change.
function deriveScheme(hex: string): Scheme {
  const c = rgb(hex)
  return { background: mix(c, 15, WHITE), border: mix(c, 45, WHITE), text: mix(c, 55, BLACK) }
}

// A stored value is either a scheme name or a custom hex. Anything else — a
// typo, hand-edited data, a bad MCP call — falls back rather than rendering
// unstyled.
export function resolveScheme(value: string, fallback: SchemeName): Scheme {
  if (isSchemeName(value)) return SCHEMES[value]
  if (isCustomHex(value)) return deriveScheme(value)
  return SCHEMES[fallback]
}

// Secondary tones are derived from the scheme rather than stored, so a scheme
// stays the three things a user is actually choosing. No single ratio works
// for every scheme (paper sits on white and has room to lighten a long way;
// sticky sits on #fef9c3 and has very little), so start close to the
// background and step back toward the text until AA is met.
export function secondaryText(s: Scheme): string {
  const text = rgb(s.text)
  const background = rgb(s.background)
  for (let pct = 70; pct <= 100; pct += 5) {
    const candidate = mix(text, pct, background)
    if (contrastRatio(rgb(candidate), background) >= 4.5) return candidate
  }
  return s.text
}

export function accentFill(s: Scheme): string {
  return mix(rgb(s.border), 35, rgb(s.background))
}
