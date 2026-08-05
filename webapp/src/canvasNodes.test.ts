import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { descendantsOf, groupsFirst } from './canvasNodes'

const n = (id: string, type: string, parentId?: string): Node =>
  ({ id, type, parentId, position: { x: 0, y: 0 }, data: {} }) as Node

describe('descendantsOf', () => {
  it('returns nothing for a node with no children', () => {
    expect(descendantsOf('a', [n('a', 'group'), n('b', 'service')])).toEqual(new Set())
  })

  it('collects children, grandchildren and deeper', () => {
    const nodes = [
      n('g1', 'group'),
      n('g2', 'group', 'g1'),
      n('s1', 'service', 'g2'),
      n('s2', 'service', 'g1'),
      n('outside', 'service'),
    ]
    expect(descendantsOf('g1', nodes)).toEqual(new Set(['g2', 's1', 's2']))
  })

  it('never includes the node itself', () => {
    const nodes = [n('g1', 'group'), n('s1', 'service', 'g1')]
    expect(descendantsOf('g1', nodes).has('g1')).toBe(false)
  })

  // This is the reparenting-cycle guard's whole job. Without the `out.has`
  // check the traversal would loop forever rather than returning.
  it('terminates on a parentId cycle instead of hanging', () => {
    const nodes = [n('a', 'group', 'b'), n('b', 'group', 'a')]
    expect(descendantsOf('a', nodes)).toEqual(new Set(['a', 'b']))
  })

  it('ignores a parentId pointing at a node that is not present', () => {
    expect(descendantsOf('ghost', [n('s1', 'service', 'ghost')])).toEqual(new Set(['s1']))
  })
})

describe('groupsFirst', () => {
  // React Flow drops a child whose parent appears later in the array, so this
  // ordering is a hard requirement rather than a cosmetic one.
  it('puts every group before every non-group', () => {
    const out = groupsFirst([n('s1', 'service'), n('g1', 'group'), n('t1', 'note')])
    expect(out.map((x) => x.type)).toEqual(['group', 'service', 'note'])
  })

  it('orders nested groups parent-before-child', () => {
    const out = groupsFirst([n('inner', 'group', 'outer'), n('outer', 'group')])
    expect(out.map((x) => x.id)).toEqual(['outer', 'inner'])
  })

  it('preserves the relative order of non-groups', () => {
    const out = groupsFirst([n('s1', 'service'), n('s2', 'service'), n('s3', 'service')])
    expect(out.map((x) => x.id)).toEqual(['s1', 's2', 's3'])
  })

  it('keeps every node — nothing is dropped', () => {
    const input = [n('g1', 'group'), n('s1', 'service', 'g1'), n('t1', 'note')]
    expect(groupsFirst(input)).toHaveLength(input.length)
  })
})
