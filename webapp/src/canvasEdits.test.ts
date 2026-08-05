import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { reparentNodes } from './canvasEdits'

const svc = (id: string, over: Partial<Node> = {}): Node =>
  ({
    id,
    type: 'service',
    position: { x: 0, y: 0 },
    data: { label: id },
    measured: { width: 180, height: 72 },
    ...over,
  }) as Node

const grp = (id: string, over: Partial<Node> = {}): Node =>
  ({
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: { label: id, color: '#64748b' },
    width: 400,
    height: 300,
    style: { width: 400, height: 300 },
    ...over,
  }) as Node

const byId = (ns: Node[], id: string) => ns.find((n) => n.id === id)!

describe('reparentNodes — selection', () => {
  it('moves every selected node, not just the fallback', () => {
    const ns = [grp('g1'), svc('a', { selected: true }), svc('b', { selected: true }), svc('c')]
    const out = reparentNodes(ns, 'g1', 'a')
    expect(byId(out, 'a').parentId).toBe('g1')
    expect(byId(out, 'b').parentId).toBe('g1')
    expect(byId(out, 'c').parentId).toBeUndefined()
  })

  it('falls back to the given id when nothing is flagged selected', () => {
    const out = reparentNodes([grp('g1'), svc('a')], 'g1', 'a')
    expect(byId(out, 'a').parentId).toBe('g1')
  })

  it('returns the array unchanged when there is nothing to move', () => {
    const ns = [grp('g1'), svc('a')]
    expect(reparentNodes(ns, 'g1', null)).toBe(ns)
  })
})

describe('reparentNodes — cycle guard', () => {
  it('refuses to parent a node to itself', () => {
    const ns = [grp('g1', { selected: true })]
    expect(reparentNodes(ns, 'g1', null)).toBe(ns)
  })

  // Nesting a group inside its own descendant would detach that whole subtree
  // from the canvas root.
  it('refuses to parent a group into its own descendant', () => {
    const ns = [grp('outer', { selected: true }), grp('inner', { parentId: 'outer' })]
    expect(reparentNodes(ns, 'inner', null)).toBe(ns)
  })

  it('still moves the eligible nodes when one of a multi-selection is refused', () => {
    const ns = [grp('g1', { selected: true }), svc('a', { selected: true })]
    const out = reparentNodes(ns, 'g1', null)
    expect(byId(out, 'a').parentId).toBe('g1')
    expect(byId(out, 'g1').parentId).toBeUndefined()
  })
})

describe('reparentNodes — un-parenting', () => {
  it('strips parentId and extent when the target is empty', () => {
    const child = svc('a', { parentId: 'g1', extent: 'parent', selected: true })
    const out = reparentNodes([grp('g1'), child], '', null)
    const moved = byId(out, 'a') as Node & { extent?: unknown }
    expect(moved.parentId).toBeUndefined()
    expect(moved.extent).toBeUndefined()
  })

  it('leaves unselected children parented', () => {
    const ns = [
      grp('g1'),
      svc('a', { parentId: 'g1', selected: true }),
      svc('b', { parentId: 'g1' }),
    ]
    const out = reparentNodes(ns, '', null)
    expect(byId(out, 'b').parentId).toBe('g1')
  })
})

describe('reparentNodes — placement', () => {
  // Entity nodes report a 0x0 footprint, which made placeInGroup stack them
  // 16px apart so they overlapped. Each incoming node must clear the last.
  it('spreads several incoming nodes instead of stacking them', () => {
    const ns = [grp('g1'), svc('a', { selected: true }), svc('b', { selected: true })]
    const out = reparentNodes(ns, 'g1', null)
    const pa = byId(out, 'a').position
    const pb = byId(out, 'b').position
    expect(pa).not.toEqual(pb)
    expect(Math.abs(pa.x - pb.x)).toBeGreaterThanOrEqual(180)
  })

  it('places an incoming node clear of an existing child', () => {
    const ns = [
      grp('g1'),
      svc('existing', { parentId: 'g1', position: { x: 12, y: 40 } }),
      svc('a', { selected: true }),
    ]
    const out = reparentNodes(ns, 'g1', null)
    expect(byId(out, 'a').position).not.toEqual({ x: 12, y: 40 })
  })
})

describe('reparentNodes — group sizing', () => {
  // reflowGroups sizes a group from its children's `size`, which is 0 for
  // entity nodes, so it under-sized a group that gained a row of them and they
  // stuck out of the right edge.
  it('grows the target group to contain a wide row of entities', () => {
    const small = grp('g1', { width: 200, height: 150, style: { width: 200, height: 150 } })
    const ns = [
      small,
      svc('a', { selected: true }),
      svc('b', { selected: true }),
      svc('c', { selected: true }),
    ]
    const out = reparentNodes(ns, 'g1', null) as (Node & { width?: number })[]
    const g = out.find((n) => n.id === 'g1')!
    const kids = out.filter((n) => n.parentId === 'g1')
    const farX = Math.max(...kids.map((k) => k.position.x + 180))
    expect(Number(g.width)).toBeGreaterThanOrEqual(farX)
  })

  it('never shrinks a group that is already larger than its contents', () => {
    const big = grp('g1', { width: 900, height: 700, style: { width: 900, height: 700 } })
    const out = reparentNodes([big, svc('a', { selected: true })], 'g1', null) as (Node & {
      width?: number
    })[]
    expect(Number(out.find((n) => n.id === 'g1')!.width)).toBeGreaterThanOrEqual(900)
  })
})

describe('reparentNodes — array ordering', () => {
  // React Flow drops a child that appears before its parent in the array.
  it('keeps every group ahead of every non-group', () => {
    const ns = [svc('a', { selected: true }), grp('g1')]
    const out = reparentNodes(ns, 'g1', null)
    expect(out.findIndex((n) => n.id === 'g1')).toBeLessThan(out.findIndex((n) => n.id === 'a'))
  })

  it('keeps a nested group ahead of its child group', () => {
    const ns = [grp('outer'), grp('inner', { parentId: 'outer' }), svc('a', { selected: true })]
    const out = reparentNodes(ns, 'inner', null)
    expect(out.findIndex((n) => n.id === 'outer')).toBeLessThan(
      out.findIndex((n) => n.id === 'inner'),
    )
  })

  it('loses no nodes', () => {
    const ns = [grp('g1'), svc('a', { selected: true }), svc('b')]
    expect(reparentNodes(ns, 'g1', null)).toHaveLength(3)
  })
})
