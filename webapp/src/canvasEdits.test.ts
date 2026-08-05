import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { applyEdgePatch, reparentNodes, resizeGroup } from './canvasEdits'
import type { AppEdge } from './canvasData'
import { DEFAULT_EDGE_COLOR } from '../shared/edgeDefaults'

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

describe('resizeGroup', () => {
  const at = (ns: Node[], id: string) =>
    ns.find((n) => n.id === id) as Node & { width?: number; height?: number }

  it('sets both dimensions on the target group only', () => {
    const out = resizeGroup([grp('g1'), grp('g2')], 'g1', { width: 500, height: 400 })
    expect(at(out, 'g1').width).toBe(500)
    expect(at(out, 'g1').height).toBe(400)
    expect(at(out, 'g2').width).toBe(400)
  })

  // The width and height inputs are edited independently, so an omitted
  // dimension must keep its current value rather than falling to the default.
  it('keeps the other dimension when only one is given', () => {
    const out = resizeGroup(
      [grp('g1', { width: 640, height: 480, style: { width: 640, height: 480 } })],
      'g1',
      { width: 500 },
    )
    expect(at(out, 'g1').width).toBe(500)
    expect(at(out, 'g1').height).toBe(480)
  })

  // A NodeResizer drag writes width/height and measured but never style, while
  // a group built from the model has only style. Reading one source dropped
  // resizes, so the fallback order is load-bearing.
  it('prefers measured over width over style', () => {
    const n = {
      ...grp('g1', { width: 500, style: { width: 400, height: 300 } }),
      measured: { width: 600, height: 300 },
    } as Node
    expect(at(resizeGroup([n], 'g1', {}), 'g1').width).toBe(600)
  })

  it('falls back to width when measured is absent', () => {
    const n = grp('g1', { width: 500, style: { width: 400, height: 300 } })
    expect(at(resizeGroup([n], 'g1', {}), 'g1').width).toBe(500)
  })

  it('falls back to style when neither measured nor width is set', () => {
    const n = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: {},
      style: { width: 456, height: 321 },
    } as Node
    const out = at(resizeGroup([n], 'g1', {}), 'g1')
    expect(out.width).toBe(456)
    expect(out.height).toBe(321)
  })

  it('falls back to 320x200 when the group carries no size at all', () => {
    const n = { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} } as Node
    const out = at(resizeGroup([n], 'g1', {}), 'g1')
    expect(out.width).toBe(320)
    expect(out.height).toBe(200)
  })

  // Writing only one of them leaves the two sources disagreeing, which is what
  // made a resize appear to revert on the next read.
  it('writes the size to both the top level and style', () => {
    const out = at(resizeGroup([grp('g1')], 'g1', { width: 500, height: 400 }), 'g1')
    expect(out.style).toMatchObject({ width: 500, height: 400 })
  })

  it('returns other nodes untouched by identity', () => {
    const other = svc('a')
    const out = resizeGroup([grp('g1'), other], 'g1', { width: 500 })
    expect(out.find((n) => n.id === 'a')).toBe(other)
  })

  it('is a no-op when the id is not present', () => {
    const ns = [grp('g1')]
    expect(resizeGroup(ns, 'nope', { width: 999 })).toEqual(ns)
  })
})

describe('applyEdgePatch', () => {
  const edge = (over: Partial<AppEdge> = {}): AppEdge =>
    ({
      id: 'e1',
      source: 'a',
      target: 'b',
      type: 'waypoint',
      data: { dir: 'forward', inferred: false, shape: 'default' },
      ...over,
    }) as AppEdge

  const only = (es: AppEdge[]) => es.find((e) => e.id === 'e1')!

  it('leaves other edges untouched by identity', () => {
    const other = edge({ id: 'e2' })
    const out = applyEdgePatch([edge(), other], 'e1', { label: 'changed' })
    expect(out.find((e) => e.id === 'e2')).toBe(other)
  })

  it('sets the label only when the patch carries one', () => {
    expect(only(applyEdgePatch([edge({ label: 'keep' })], 'e1', { dir: 'both' })).label).toBe(
      'keep',
    )
    expect(only(applyEdgePatch([edge({ label: 'keep' })], 'e1', { label: 'new' })).label).toBe(
      'new',
    )
  })

  it('allows an empty label, which is not the same as omitting it', () => {
    expect(only(applyEdgePatch([edge({ label: 'x' })], 'e1', { label: '' })).label).toBe('')
  })

  it('stores dir so restyleEdge can recompute the arrowheads', () => {
    expect(only(applyEdgePatch([edge()], 'e1', { dir: 'both' })).data!.dir).toBe('both')
  })

  it('keeps the current value for anything the patch omits', () => {
    const start = edge({ data: { dir: 'both', inferred: true, shape: 'default' } })
    const out = only(applyEdgePatch([start], 'e1', {}))
    expect(out.data!.dir).toBe('both')
    expect((out.style as { strokeDasharray?: string }).strokeDasharray).toBeTruthy()
  })

  it('applies a colour override on top of the type colour', () => {
    const out = only(applyEdgePatch([edge()], 'e1', { color: '#ff0000' }))
    expect(out.data!.color).toBe('#ff0000')
    expect((out.style as { stroke?: string }).stroke).toBe('#ff0000')
  })

  // There is no clearing anywhere in the app. { color: undefined } is now
  // indistinguishable from omitting the key — both leave the colour alone.
  // Resetting an edge means SETTING the starting colour, the same gesture
  // groups have always used. The old present-vs-absent rule existed only to
  // support falling back to a relationship type that cannot be changed from
  // the UI or over MCP, and it cost a shipped bug when it was once narrowed.
  it('leaves the colour alone when color is explicitly undefined', () => {
    const coloured = edge({
      data: { dir: 'forward', inferred: false, shape: 'default', color: '#ff0000' },
    })
    const out = only(applyEdgePatch([coloured], 'e1', { color: undefined }))
    expect(out.data!.color).toBe('#ff0000')
    expect((out.style as { stroke?: string }).stroke).toBe('#ff0000')
  })

  it('resets by setting the starting colour explicitly', () => {
    const coloured = edge({
      data: {
        dir: 'forward',
        inferred: false,
        shape: 'default',
        color: '#ff0000',
      },
    })
    const out = only(applyEdgePatch([coloured], 'e1', { color: DEFAULT_EDGE_COLOR }))
    expect(out.data!.color).toBe('#64748b')
    expect((out.style as { stroke?: string }).stroke).toBe('#64748b')
  })

  // A patch that changes something else must not disturb the colour.
  it('keeps the current colour when the patch omits it entirely', () => {
    const coloured = edge({
      data: {
        dir: 'forward',
        inferred: false,
        shape: 'default',
        color: '#ff0000',
      },
    })
    const out = only(applyEdgePatch([coloured], 'e1', { label: 'x' }))
    expect(out.data!.color).toBe('#ff0000')
    expect((out.style as { stroke?: string }).stroke).toBe('#ff0000')
  })

  it('is a no-op when the id is not present', () => {
    const es = [edge()]
    expect(applyEdgePatch(es, 'nope', { label: 'x' })).toEqual(es)
  })
})
