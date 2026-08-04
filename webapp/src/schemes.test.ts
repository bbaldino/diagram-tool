import { describe, it, expect } from 'vitest'
import { SCHEMES, NEW_NODE_SCHEME, NEW_NOTE_SCHEME, resolveScheme } from './schemes'

describe('scheme table', () => {
  it('has no scheme named "default" — default is a starting value, not a colour', () => {
    expect(Object.keys(SCHEMES)).not.toContain('default')
  })

  it('names the starting schemes for nodes and notes, and both are real entries', () => {
    expect(SCHEMES[NEW_NODE_SCHEME]).toBeDefined()
    expect(SCHEMES[NEW_NOTE_SCHEME]).toBeDefined()
  })

  it('reproduces the current node default exactly', () => {
    expect(SCHEMES.paper).toEqual({
      background: '#ffffff',
      border: '#cbd5e1',
      text: '#1f2937',
    })
  })

  // The sticky background and border still reproduce the historic note exactly.
  // Its text does NOT: the original #713f12 cleared AA at 8.07:1 but read as
  // faint against the yellow, and was darkened deliberately. Pinned so the
  // change stays intentional rather than drifting.
  it('keeps the note background and border, with deliberately darker text', () => {
    expect(SCHEMES.sticky.background).toBe('#fef9c3')
    expect(SCHEMES.sticky.border).toBe('#fde047')
    expect(SCHEMES.sticky.text).toBe('#4a2a0c')
    expect(SCHEMES.sticky.text).not.toBe('#713f12')
  })
})

describe('resolveScheme', () => {
  it('looks up a known name', () => {
    expect(resolveScheme('blue', NEW_NODE_SCHEME)).toEqual(SCHEMES.blue)
  })

  it('derives a scheme from a hex, matching the previous derivation ratios', () => {
    // background 15% over white, border 45% over white, text 55% toward black
    expect(resolveScheme('#3b82f6', NEW_NODE_SCHEME)).toEqual({
      background: '#e2ecfe',
      border: '#a7c7fb',
      text: '#204887',
    })
  })

  it('falls back to the given scheme for an unknown name rather than throwing', () => {
    expect(resolveScheme('nonsense', NEW_NODE_SCHEME)).toEqual(SCHEMES.paper)
  })

  it('falls back for a malformed hex too', () => {
    expect(resolveScheme('#12345', NEW_NOTE_SCHEME)).toEqual(SCHEMES.sticky)
  })
})
