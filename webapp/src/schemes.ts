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

export const SCHEMES: Record<string, Scheme> = {
  // The two starting schemes, byte-identical to the previous literal defaults.
  paper: { background: '#ffffff', border: '#cbd5e1', text: '#1f2937' },
  sticky: { background: '#fef9c3', border: '#fde047', text: '#713f12' },
  // The former PALETTE, resolved once at authoring time.
  slate: { background: '#e8eaee', border: '#b9c0cb', text: '#37404c' },
  red: { background: '#fde3e3', border: '#f8abab', text: '#832525' },
  orange: { background: '#feeadc', border: '#fcc096', text: '#893f0c' },
  amber: { background: '#fef0da', border: '#fad391', text: '#875706' },
  yellow: { background: '#fcf4da', border: '#f6dd90', text: '#816204' },
  emerald: { background: '#dbf4ec', border: '#93e0c6', text: '#096647' },
  teal: { background: '#dcf4f2', border: '#95dfd7', text: '#0b655b' },
  blue: { background: '#e2ecfe', border: '#a7c7fb', text: '#204887' },
  indigo: { background: '#e8e8fd', border: '#b9baf9', text: '#363885' },
  violet: { background: '#eee7fe', border: '#cbb6fb', text: '#4c3387' },
  pink: { background: '#fce4f0', border: '#f6add1', text: '#822854' },
}

// The ONLY place "default" exists: which scheme a new entity starts with.
export const NEW_NODE_SCHEME = 'paper'
export const NEW_NOTE_SCHEME = 'sticky'

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

// A custom hex derives a scheme using the ratios the old renderer used, so a
// custom colour looks exactly as it did before this change.
function deriveScheme(hex: string): Scheme {
  const c = rgb(hex)
  return { background: mix(c, 15, WHITE), border: mix(c, 45, WHITE), text: mix(c, 55, BLACK) }
}

// A stored value is either a scheme name or a custom hex. Anything else — a
// typo, hand-edited data, a bad MCP call — falls back rather than rendering
// unstyled.
export function resolveScheme(value: string, fallback: string): Scheme {
  if (SCHEMES[value]) return SCHEMES[value]
  if (HEX.test(value)) return deriveScheme(value)
  return SCHEMES[fallback]
}

// Secondary tones are derived from the scheme rather than stored, so a scheme
// stays the three things a user is actually choosing.
export function secondaryText(s: Scheme): string {
  // 95, not 70: at 70 twelve of the thirteen schemes failed AA (yellow as low
  // as 2.9:1). 95 clears every scheme, worst case yellow at ~4.7:1.
  return mix(rgb(s.text), 95, rgb(s.background))
}

export function accentFill(s: Scheme): string {
  return mix(rgb(s.border), 35, rgb(s.background))
}
