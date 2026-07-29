import { describe, it, expect } from 'vitest'
import { runElk } from './layout-elk'

describe('runElk', () => {
  it('lays out flat boxes and returns a position per box', async () => {
    const pos = await runElk(
      [
        { id: 'a', width: 180, height: 64 },
        { id: 'b', width: 180, height: 64 },
      ],
      [{ from: 'a', to: 'b' }],
    )
    expect(Object.keys(pos).sort()).toEqual(['a', 'b'])
    // layered RIGHT → b is to the right of a
    expect(pos.b.x).toBeGreaterThan(pos.a.x)
    expect(typeof pos.a.y).toBe('number')
  })
})
