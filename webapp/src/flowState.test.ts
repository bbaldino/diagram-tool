import { describe, it, expect } from 'vitest'
import { flowStates } from './flowState'

const flow = {
  id: 'f',
  name: 'F',
  steps: [
    { id: 's1', elementIds: ['a'] },
    { id: 's2', elementIds: ['b', 'e1'] },
    { id: 's3', elementIds: ['c'] },
  ],
}

describe('flowStates', () => {
  it('step 0: only the first set is active', () => {
    expect(flowStates(flow, 0)).toEqual({ a: 'active' })
  })
  it('step 1: prior set lit, current set active', () => {
    expect(flowStates(flow, 1)).toEqual({ a: 'lit', b: 'active', e1: 'active' })
  })
  it('last step: earlier all lit, last active', () => {
    expect(flowStates(flow, 2)).toEqual({ a: 'lit', b: 'lit', e1: 'lit', c: 'active' })
  })
  it('clamps out-of-range indices and handles empty flows', () => {
    expect(flowStates(flow, 99).c).toBe('active') // clamped to last
    expect(flowStates(flow, -5)).toEqual({ a: 'active' }) // clamped to 0
    expect(flowStates({ id: 'x', name: 'x', steps: [] }, 0)).toEqual({})
  })
  it('an id appearing in two steps keeps its earliest-lit status but is active if in the current step', () => {
    const f2 = {
      id: 'f',
      name: 'F',
      steps: [
        { id: 's1', elementIds: ['a'] },
        { id: 's2', elementIds: ['a'] },
      ],
    }
    expect(flowStates(f2, 1)).toEqual({ a: 'active' })
  })
})
