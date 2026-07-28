import { describe, it, expect } from 'vitest'
import type { Edge, Connection } from '@xyflow/react'
import { applyReconnect } from './graph'

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
