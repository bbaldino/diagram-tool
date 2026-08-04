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

  it('reproduces the current note default exactly', () => {
    expect(SCHEMES.sticky).toEqual({
      background: '#fef9c3',
      border: '#fde047',
      text: '#713f12',
    })
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
