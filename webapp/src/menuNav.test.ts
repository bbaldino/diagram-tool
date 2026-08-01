import { describe, it, expect } from 'vitest'
import { moveMenuHighlight, firstEnabledIndex, lastEnabledIndex, type MenuItem } from './menuNav'

const items: MenuItem[] = [
  { id: 'new', label: 'New diagram' },
  { id: 'open', label: 'Open diagram…', disabled: true },
  { id: 'rename', label: 'Rename…' },
  { id: 'reset', label: 'Reset diagram…', danger: true },
]

describe('menuNav', () => {
  it('moves down skipping disabled, wrapping', () => {
    expect(moveMenuHighlight(items, -1, 1)).toBe(0) // none → first enabled
    expect(moveMenuHighlight(items, 0, 1)).toBe(2) // skip disabled 'open'
    expect(moveMenuHighlight(items, 2, 1)).toBe(3)
    expect(moveMenuHighlight(items, 3, 1)).toBe(0) // wrap
  })
  it('moves up skipping disabled, wrapping', () => {
    expect(moveMenuHighlight(items, -1, -1)).toBe(3) // none + up → last enabled
    expect(moveMenuHighlight(items, 2, -1)).toBe(0) // skip disabled 'open'
    expect(moveMenuHighlight(items, 0, -1)).toBe(3) // wrap
  })
  it('first/last enabled', () => {
    expect(firstEnabledIndex(items)).toBe(0)
    expect(lastEnabledIndex(items)).toBe(3)
  })
  it('all-disabled → -1', () => {
    const d = items.map((i) => ({ ...i, disabled: true }))
    expect(moveMenuHighlight(d, -1, 1)).toBe(-1)
    expect(firstEnabledIndex(d)).toBe(-1)
  })
})
