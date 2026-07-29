import { describe, it, expect } from 'vitest'
import type { Edge, Connection, Node } from '@xyflow/react'
import {
  applyReconnect,
  topoOrderByParent,
  requiredGroupSize,
  paddedExtent,
  placeInGroup,
  growGroupsToFitChildren,
  shrinkGroupToChildren,
  reflowGroups,
  GROUP_PAD,
  GROUP_MIN,
  GROUP_NEST_TOP_PAD,
  GROUP_SLACK,
} from './graph'

const edge = (over: Partial<Edge> = {}): Edge => ({
  id: 'e0-npm-authelia', source: 'npm', target: 'authelia', type: 'waypoint',
  data: { points: [{ x: 5, y: 5 }], shape: 'default' }, ...over,
})

describe('applyReconnect', () => {
  it('rewires the target, preserves the id, and clears manual waypoints', () => {
    const edges = [edge()]
    const conn: Connection = { source: 'npm', target: 'sonarr', sourceHandle: null, targetHandle: null }
    const out = applyReconnect(edges[0], conn, edges)
    const e = out.find((x) => x.id === 'e0-npm-authelia')!
    expect(e).toBeTruthy()                          // id unchanged (NOT regenerated)
    expect(e.source).toBe('npm')
    expect(e.target).toBe('sonarr')                 // rewired
    expect((e.data as any).points).toEqual([])      // waypoints cleared
    expect((e.data as any).shape).toBe('default')   // other data preserved
  })

  it('rewires the source and its handle', () => {
    const edges = [edge()]
    const conn: Connection = { source: 'plex', target: 'authelia', sourceHandle: 'right', targetHandle: 'left' }
    const out = applyReconnect(edges[0], conn, edges)
    const e = out.find((x) => x.id === 'e0-npm-authelia')!
    expect(e.source).toBe('plex')
    expect(e.sourceHandle).toBe('right')
    expect(e.targetHandle).toBe('left')
  })

  it('leaves other edges untouched', () => {
    const other = edge({ id: 'e1-a-b', source: 'a', target: 'b', data: { points: [{ x: 1, y: 1 }] } })
    const edges = [edge(), other]
    const conn: Connection = { source: 'npm', target: 'sonarr', sourceHandle: null, targetHandle: null }
    const out = applyReconnect(edges[0], conn, edges)
    const e1 = out.find((x) => x.id === 'e1-a-b')!
    expect(e1.target).toBe('b')
    expect((e1.data as any).points).toEqual([{ x: 1, y: 1 }]) // its waypoints untouched
  })
})

describe('topoOrderByParent', () => {
  type Item = { id: string; parentId?: string | null }

  it('reorders a child that appears before its parent (the reparent regression)', () => {
    // Group A created first, then group B: array starts [A, B]. Reparenting A
    // under B (App.tsx's `reparent`) only sets A.parentId — it doesn't move A
    // after B — so without topo ordering React Flow would see the child (A)
    // before its parent (B).
    const items: Item[] = [{ id: 'A', parentId: 'B' }, { id: 'B' }]
    const out = topoOrderByParent(items)
    expect(out.map((i) => i.id)).toEqual(['B', 'A'])
  })

  it('orders a chain of nested groups outer-to-inner regardless of input order', () => {
    const items: Item[] = [
      { id: 'grandchild', parentId: 'child' },
      { id: 'child', parentId: 'root' },
      { id: 'root' },
    ]
    const out = topoOrderByParent(items)
    const index = new Map(out.map((it, i) => [it.id, i]))
    expect(index.get('root')!).toBeLessThan(index.get('child')!)
    expect(index.get('child')!).toBeLessThan(index.get('grandchild')!)
  })

  it('is stable for items with no ordering constraint between them', () => {
    const items: Item[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    expect(topoOrderByParent(items).map((i) => i.id)).toEqual(['x', 'y', 'z'])
  })

  it('does not hang on a cycle', () => {
    const items: Item[] = [{ id: 'p', parentId: 'q' }, { id: 'q', parentId: 'p' }]
    const out = topoOrderByParent(items)
    expect(out.map((i) => i.id).sort()).toEqual(['p', 'q'])
  })

  it('treats a missing/unresolvable parentId as a root', () => {
    const items: Item[] = [{ id: 'orphan', parentId: 'nonexistent' }, { id: 'root' }]
    const out = topoOrderByParent(items)
    expect(out.map((i) => i.id)).toEqual(['orphan', 'root'])
  })
})

describe('requiredGroupSize', () => {
  it('floors at the minimum when there are no children', () => {
    expect(requiredGroupSize([])).toEqual(GROUP_MIN)
  })

  it('floors at the minimum when children fit comfortably inside it', () => {
    const children = [{ position: { x: 16, y: 16 }, size: { width: 40, height: 40 } }]
    expect(requiredGroupSize(children)).toEqual(GROUP_MIN)
  })

  it('grows past the minimum to contain a child, with pad clearance on the right/bottom', () => {
    const children = [{ position: { x: 16, y: 16 }, size: { width: 300, height: 200 } }]
    expect(requiredGroupSize(children)).toEqual({
      width: 16 + 300 + GROUP_PAD,
      height: 16 + 200 + GROUP_PAD,
    })
  })

  it('sizes to the max extent across multiple children', () => {
    const children = [
      { position: { x: 16, y: 16 }, size: { width: 300, height: 40 } },
      { position: { x: 16, y: 300 }, size: { width: 40, height: 40 } },
    ]
    const size = requiredGroupSize(children)
    expect(size.width).toBe(16 + 300 + GROUP_PAD) // widest child wins width
    expect(size.height).toBe(300 + 40 + GROUP_PAD) // lowest child wins height
  })

  it('honors custom pad/min overrides', () => {
    const children = [{ position: { x: 0, y: 0 }, size: { width: 50, height: 50 } }]
    expect(requiredGroupSize(children, 10, { width: 0, height: 0 })).toEqual({ width: 60, height: 60 })
  })
})

describe('paddedExtent', () => {
  // NOTE: extent[1] is the padded region's far edge — RF's own clampPosition
  // (@xyflow/system) subtracts the node's `measured` width/height from
  // extent[1] itself before clamping node.position, both on mount and on
  // drag. So extent[1] must NOT also be backed off by childSize here, or the
  // subtraction happens twice — see the "never inverts" case below for why
  // that matters (it's the exact bug this fix targets).

  it('keeps top-left at [GROUP_PAD, GROUP_NEST_TOP_PAD] and sets bottom-right to the padded region edge (parentSize - GROUP_PAD)', () => {
    const extent = paddedExtent({ width: 400, height: 300 }, { width: 100, height: 50 })
    expect(extent).toEqual([
      [GROUP_PAD, GROUP_NEST_TOP_PAD],
      [400 - GROUP_PAD, 300 - GROUP_PAD],
    ])
  })

  it('treats an unknown (zero) child size as a top-left padded clamp using the taller top pad', () => {
    const extent = paddedExtent({ width: 220, height: 130 }, { width: 0, height: 0 })
    expect(extent).toEqual([
      [GROUP_PAD, GROUP_NEST_TOP_PAD],
      [220 - GROUP_PAD, 130 - GROUP_PAD],
    ])
  })

  it('never inverts the extent when the child is as big as (or bigger than) the padded interior', () => {
    // This is exactly the overlap-bug scenario: a child nearly as big as its
    // parent. Naively setting extent[1] to (parentSize - pad - childSize)
    // here (double-subtracting childSize, since RF subtracts it again
    // internally) would make RF's clamp() computed max go NEGATIVE — and
    // since Math.min(Math.max(v,min),max) returns max when max < min, the
    // node would snap far off to the negative side instead of holding at
    // [pad,pad]. The pad+childSize floor below keeps RF's own subtraction
    // (extent[1] - childSize) landing at exactly `pad`/`topPad`, never less.
    const extent = paddedExtent({ width: 240, height: 146 }, { width: 240, height: 146 })
    expect(extent).toEqual([
      [GROUP_PAD, GROUP_NEST_TOP_PAD],
      [GROUP_PAD + 240, GROUP_NEST_TOP_PAD + 146], // RF's (extent[1] - childSize) lands at exactly `pad`/`topPad`
    ])
  })

  it('clamps a child dragged to the very top of its extent clear of the parent title strip (GROUP_NEST_TOP_PAD, not GROUP_PAD)', () => {
    // The title-overlap regression this fix targets: dragging a nested
    // group's title straight up must stop it at the SAME top clearance a
    // freshly-nested child starts at, not fall back to the narrower
    // horizontal GROUP_PAD.
    const extent = paddedExtent({ width: 400, height: 300 }, { width: 220, height: 130 })
    const [[, minY]] = extent
    expect(minY).toBe(GROUP_NEST_TOP_PAD)
    expect(minY).toBeGreaterThan(GROUP_PAD)
  })
})

describe('placeInGroup', () => {
  it('returns the padded top-left when the group has no existing children', () => {
    expect(placeInGroup({ width: 100, height: 60 }, [])).toEqual({
      x: GROUP_PAD,
      y: GROUP_NEST_TOP_PAD,
    })
  })

  it('places the child to the right of a single existing sibling, with a gap, non-overlapping', () => {
    const sibling = { position: { x: 16, y: 32 }, size: { width: 150, height: 80 } }
    const pos = placeInGroup({ width: 100, height: 60 }, [sibling])
    expect(pos).toEqual({ x: 16 + 150 + 16, y: GROUP_NEST_TOP_PAD })
    // non-overlapping: the new child's left edge is at/after the sibling's right edge
    expect(pos.x).toBeGreaterThanOrEqual(sibling.position.x + sibling.size.width)
  })

  it('places the child to the right of the widest reach across multiple siblings', () => {
    const siblings = [
      { position: { x: 16, y: 32 }, size: { width: 100, height: 60 } }, // right edge 116
      { position: { x: 200, y: 32 }, size: { width: 50, height: 60 } }, // right edge 250 (wins)
    ]
    const pos = placeInGroup({ width: 80, height: 40 }, siblings)
    expect(pos).toEqual({ x: 250 + 16, y: GROUP_NEST_TOP_PAD })
  })

  it('honors custom pad/gap overrides', () => {
    expect(placeInGroup({ width: 10, height: 10 }, [], 5, 40, 8)).toEqual({ x: 5, y: 40 })
    const sibling = { position: { x: 5, y: 40 }, size: { width: 20, height: 20 } }
    expect(placeInGroup({ width: 10, height: 10 }, [sibling], 5, 40, 8)).toEqual({ x: 5 + 20 + 8, y: 40 })
  })
})

describe('growGroupsToFitChildren', () => {
  const group = (over: Partial<Node> = {}): Node => ({
    id: 'g', type: 'group', position: { x: 0, y: 0 }, data: {}, style: { width: 220, height: 130 }, ...over,
  })
  const service = (over: Partial<Node> = {}): Node => ({
    id: 's', type: 'service', position: { x: 0, y: 0 }, data: {}, ...over,
  })

  it('leaves a group at GROUP_MIN when it has no children', () => {
    const out = growGroupsToFitChildren([group()])
    expect(out[0].style).toMatchObject(GROUP_MIN)
  })

  it('grows a group to contain a child that overflows it, plus movability slack', () => {
    const nodes = [
      group({ id: 'g1', style: { width: 220, height: 130 } }),
      service({ id: 's1', parentId: 'g1', position: { x: 16, y: 16 } }),
      group({ id: 'g2', parentId: 'g1', position: { x: 16, y: 16 }, style: { width: 300, height: 200 } }),
    ]
    const out = growGroupsToFitChildren(nodes)
    const g1 = out.find((n) => n.id === 'g1')!
    // must contain the nested group g2 (300x200 at 16,16) with GROUP_PAD
    // clearance, plus GROUP_SLACK so g2 isn't grown skin-tight around it
    expect((g1.style as any).width).toBe(16 + 300 + GROUP_PAD + GROUP_SLACK)
    expect((g1.style as any).height).toBe(16 + 200 + GROUP_PAD + GROUP_SLACK)
  })

  it('adds no slack to an empty group — it stays at GROUP_MIN', () => {
    const out = growGroupsToFitChildren([group({ id: 'g1', style: { width: 220, height: 130 } })])
    expect(out[0].style).toMatchObject(GROUP_MIN)
  })

  it('leaves a lone nested child room to move: paddedExtent has a non-degenerate range on both axes', () => {
    // The pinned-child regression: a parent grown to EXACTLY fit its child
    // collapses that child's paddedExtent to a single point. After growth
    // with GROUP_SLACK, there must be actual room between the extent's min
    // and max beyond the child's own footprint.
    const child = { width: 240, height: 146 }
    const nodes = [
      group({ id: 'outer', style: { width: 240, height: 146 } }),
      group({ id: 'inner', parentId: 'outer', position: { x: 16, y: 16 }, style: child }),
    ]
    const out = growGroupsToFitChildren(nodes)
    const outer = out.find((n) => n.id === 'outer')!
    const outerStyle = outer.style as any
    const extent = paddedExtent({ width: outerStyle.width, height: outerStyle.height }, child)
    expect(extent[1][0] - extent[0][0] - child.width).toBeGreaterThan(0)
    expect(extent[1][1] - extent[0][1] - child.height).toBeGreaterThan(0)
  })

  it('a nested group always ends up strictly smaller than its (grown) parent', () => {
    // The regression scenario: child group is ~as big as the parent.
    const nodes = [
      group({ id: 'outer', style: { width: 240, height: 146 } }),
      group({ id: 'inner', parentId: 'outer', position: { x: 16, y: 16 }, style: { width: 240, height: 146 } }),
    ]
    const out = growGroupsToFitChildren(nodes)
    const outer = out.find((n) => n.id === 'outer')!
    const inner = out.find((n) => n.id === 'inner')!
    expect((outer.style as any).width).toBeGreaterThan((inner.style as any).width)
    expect((outer.style as any).height).toBeGreaterThan((inner.style as any).height)
  })

  it('cascades growth outward through multiple nesting levels', () => {
    const nodes = [
      group({ id: 'a', style: { width: 220, height: 130 } }),
      group({ id: 'b', parentId: 'a', position: { x: 16, y: 16 }, style: { width: 220, height: 130 } }),
      group({ id: 'c', parentId: 'b', position: { x: 16, y: 16 }, style: { width: 220, height: 130 } }),
    ]
    const out = growGroupsToFitChildren(nodes)
    const byId = new Map(out.map((n) => [n.id, (n.style as any)]))
    // each level must be strictly bigger than the one it contains
    expect(byId.get('a').width).toBeGreaterThan(byId.get('b').width)
    expect(byId.get('b').width).toBeGreaterThan(byId.get('c').width)
    expect(byId.get('a').height).toBeGreaterThan(byId.get('b').height)
    expect(byId.get('b').height).toBeGreaterThan(byId.get('c').height)
  })

  it('never shrinks a group below its current size', () => {
    const nodes = [group({ id: 'g1', style: { width: 600, height: 500 } })]
    const out = growGroupsToFitChildren(nodes)
    const g1 = out.find((n) => n.id === 'g1')!
    expect(g1.style).toMatchObject({ width: 600, height: 500 })
  })

  it('leaves non-group nodes untouched', () => {
    const nodes = [group({ id: 'g1' }), service({ id: 's1', parentId: 'g1' })]
    const out = growGroupsToFitChildren(nodes)
    const s1 = out.find((n) => n.id === 's1')!
    expect(s1).toEqual(nodes[1])
  })
})

describe('reflowGroups', () => {
  const group = (over: Partial<Node> = {}): Node => ({
    id: 'g', type: 'group', position: { x: 0, y: 0 }, data: {}, style: { width: 220, height: 130 }, ...over,
  })

  it('grows the parent AND updates the nested child extent from the grown size', () => {
    const nodes = [
      group({ id: 'outer', style: { width: 240, height: 146 } }),
      group({ id: 'inner', parentId: 'outer', position: { x: 16, y: 16 }, style: { width: 240, height: 146 } }),
    ]
    const out = reflowGroups(nodes)
    const outer = out.find((n) => n.id === 'outer')!
    const inner = out.find((n) => n.id === 'inner')!
    const outerStyle = outer.style as any
    expect(outerStyle.width).toBeGreaterThan(240)
    // inner's extent must be computed against the GROWN outer size, not the stale 240x146
    expect(inner.extent).toEqual(paddedExtent({ width: outerStyle.width, height: outerStyle.height }, { width: 240, height: 146 }))
  })

  it('leaves an un-parented node without an extent', () => {
    const out = reflowGroups([group({ id: 'g1' })])
    expect(out[0].extent).toBeUndefined()
  })

  it('leaves a node with a dangling parentId (no matching parent node) untouched', () => {
    const service: Node = { id: 's1', type: 'service', parentId: 'ghost', position: { x: 0, y: 0 }, data: {} }
    const out = reflowGroups([service])
    expect(out[0]).toEqual(service)
  })
})

describe('shrinkGroupToChildren', () => {
  const group = (over: Partial<Node> = {}): Node => ({
    id: 'g', type: 'group', position: { x: 0, y: 0 }, data: {}, style: { width: 400, height: 400 }, ...over,
  })
  const service = (over: Partial<Node> = {}): Node => ({
    id: 's', type: 'service', position: { x: 0, y: 0 }, data: {}, ...over,
  })
  const note = (over: Partial<Node> = {}): Node => ({
    id: 'n', type: 'note', position: { x: 0, y: 0 }, data: {}, style: { width: 160, height: 90 }, ...over,
  })

  it('sizes the group to contain a NOTE child, not just its service nodes (the reported bug)', () => {
    const nodes = [
      group({ id: 'g1', style: { width: 400, height: 400 } }),
      service({ id: 's1', parentId: 'g1', position: { x: 16, y: 32 } }),
      note({ id: 'n1', parentId: 'g1', position: { x: 16, y: 200 }, style: { width: 160, height: 90 } }),
    ]
    const out = shrinkGroupToChildren(nodes, 'g1')
    const g1 = out.find((n) => n.id === 'g1')!.style as any
    // the note sits at y=200 (bottom 290); the group must still contain it, not
    // clip down to fit only the (zero-footprint) service node.
    expect(g1.height).toBeGreaterThanOrEqual(200 + 90 + GROUP_PAD)
    expect(g1.width).toBeGreaterThanOrEqual(16 + 160 + GROUP_PAD)
  })

  it('sizes the group to contain a nested SUB-GROUP child', () => {
    const nodes = [
      group({ id: 'outer', style: { width: 200, height: 200 } }),
      group({ id: 'inner', parentId: 'outer', position: { x: 16, y: 32 }, style: { width: 300, height: 220 } }),
    ]
    const out = shrinkGroupToChildren(nodes, 'outer')
    const outer = out.find((n) => n.id === 'outer')!.style as any
    expect(outer.width).toBeGreaterThanOrEqual(16 + 300 + GROUP_PAD)
    expect(outer.height).toBeGreaterThanOrEqual(32 + 220 + GROUP_PAD)
  })

  it('shrinks an oversized group down to wrap its children', () => {
    const nodes = [
      group({ id: 'g1', style: { width: 900, height: 900 } }),
      service({ id: 's1', parentId: 'g1', position: { x: 16, y: 32 } }),
      note({ id: 'n1', parentId: 'g1', position: { x: 16, y: 120 }, style: { width: 160, height: 90 } }),
    ]
    const out = shrinkGroupToChildren(nodes, 'g1')
    const g1 = out.find((n) => n.id === 'g1')!.style as any
    expect(g1.width).toBeLessThan(900)
    expect(g1.height).toBeLessThan(900)
  })

  it('an empty group shrinks to GROUP_MIN (no slack for no children)', () => {
    const out = shrinkGroupToChildren([group({ id: 'g1', style: { width: 800, height: 800 } })], 'g1')
    expect(out.find((n) => n.id === 'g1')!.style).toMatchObject(GROUP_MIN)
  })
})
