import { describe, expect, it, beforeEach } from 'vitest'
import { setLabelPlacements, getLabelPlacement } from './labelPlacement'

beforeEach(() => setLabelPlacements(new Map()))

describe('labelPlacement store', () => {
  it('returns a set placement by id, undefined otherwise', () => {
    setLabelPlacements(new Map([['e1', { labelPos: 0.7, offset: { x: 2, y: -3 } }]]))
    expect(getLabelPlacement('e1')).toEqual({ labelPos: 0.7, offset: { x: 2, y: -3 } })
    expect(getLabelPlacement('missing')).toBeUndefined()
  })
})
