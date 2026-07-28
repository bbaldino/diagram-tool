import { describe, it, expect } from 'vitest'
import { newId } from './ids'

describe('newId', () => {
  it('returns a bare uuid v4 (no prefix), distinct each call', () => {
    const a = newId()
    const b = newId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
