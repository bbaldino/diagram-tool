import { describe, expect, it } from 'vitest'
import { groupNodes, ungroupNodes, type NodeLike } from './grouping'

const svc = (id: string, x: number, y: number): NodeLike => ({
  id,
  type: 'service',
  position: { x, y },
  measured: { width: 180, height: 72 },
})

describe('groupNodes', () => {
  it('creates a group and reparents the selection, preserving arrangement', () => {
    const nodes = [svc('a', 100, 100), svc('b', 340, 180), svc('c', 999, 999)]
    const out = groupNodes(nodes, ['a', 'b'], 'g1', 'New Group', '#64748b')
    const g = out.find((n) => n.id === 'g1')!
    const a = out.find((n) => n.id === 'a')!
    const b = out.find((n) => n.id === 'b')!
    const c = out.find((n) => n.id === 'c')!
    expect(g.type).toBe('group')
    expect(out[0].id).toBe('g1') // group first (parent before children)
    expect(a.parentId).toBe('g1')
    expect(b.parentId).toBe('g1')
    expect(c.parentId).toBeUndefined() // unselected untouched
    // arrangement preserved: b was 240 right / 80 down of a
    expect(b.position.x - a.position.x).toBe(240)
    expect(b.position.y - a.position.y).toBe(80)
    // group sized at least the minimum
    expect(g.style!.width).toBeGreaterThanOrEqual(220)
    expect(g.style!.height).toBeGreaterThanOrEqual(130)
    // only the group is selected
    expect(g.selected).toBe(true)
    expect(a.selected).toBe(false)
  })

  it('is a no-op when no ids match', () => {
    const nodes = [svc('a', 0, 0)]
    expect(groupNodes(nodes, ['nope'], 'g1', 'X', '#000')).toEqual(nodes)
  })
})

describe('ungroupNodes', () => {
  it('removes the group and lifts children to absolute positions', () => {
    const nodes: NodeLike[] = [
      { id: 'g1', type: 'group', position: { x: 50, y: 60 }, style: { width: 300, height: 200 } },
      { id: 'a', type: 'service', position: { x: 16, y: 40 }, parentId: 'g1', extent: 'parent' },
    ]
    const out = ungroupNodes(nodes, 'g1')
    expect(out.find((n) => n.id === 'g1')).toBeUndefined()
    const a = out.find((n) => n.id === 'a')!
    expect(a.parentId).toBeUndefined()
    expect(a.extent).toBeUndefined()
    expect(a.position).toEqual({ x: 66, y: 100 }) // 50+16, 60+40
  })

  it('group then ungroup restores the original absolute positions', () => {
    const nodes = [svc('a', 100, 100), svc('b', 340, 180)]
    const grouped = groupNodes(nodes, ['a', 'b'], 'g1', 'G', '#64748b')
    const back = ungroupNodes(grouped, 'g1')
    const a = back.find((n) => n.id === 'a')!
    const b = back.find((n) => n.id === 'b')!
    expect(a.position).toEqual({ x: 100, y: 100 })
    expect(b.position).toEqual({ x: 340, y: 180 })
  })
})
