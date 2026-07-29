import { describe, it, expect } from 'vitest'
import { runGraphviz } from './layout-graphviz'

describe('runGraphviz', () => {
  it('lays out flat boxes and returns a position per box', async () => {
    const pos = await runGraphviz(
      [
        { id: 'a', width: 180, height: 64 },
        { id: 'b', width: 180, height: 64 },
      ],
      [{ from: 'a', to: 'b' }],
    )
    expect(Object.keys(pos).sort()).toEqual(['a', 'b'])
    expect(pos.b.x).toBeGreaterThan(pos.a.x) // rankdir=LR
  })
})
