import { describe, expect, it, beforeEach } from 'vitest'
import { setEdgeRoutes, getEdgeRoute } from './edgeRoutes'

beforeEach(() => setEdgeRoutes(new Map()))

describe('edgeRoutes store', () => {
  it('returns a set route by id, undefined otherwise', () => {
    setEdgeRoutes(new Map([['e1', 'M 0,0 L 10,10']]))
    expect(getEdgeRoute('e1')).toBe('M 0,0 L 10,10')
    expect(getEdgeRoute('missing')).toBeUndefined()
  })
})
