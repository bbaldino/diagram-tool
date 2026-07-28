import { describe, it, expect } from 'vitest'
import type { Edge, Connection } from '@xyflow/react'
import { applyReconnect, topoOrderByParent } from './graph'

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
