import { describe, it, expect } from 'vitest'
import {
  parentOf,
  containerChain,
  lcaContainer,
  boxAtContainer,
  contractEdges,
} from './layout-tree'
import type { Diagram } from '../shared/model'

// Root → B{ b1, C{ c1, D{ d1, d2 } } }
const mk = (): Diagram => ({
  id: 'd',
  name: 'D',
  title: 'D',
  type: 'canvas',
  groups: [
    { id: 'B', label: 'B', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
    {
      id: 'C',
      label: 'C',
      color: '#000',
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      parentId: 'B',
    },
    {
      id: 'D',
      label: 'D',
      color: '#000',
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      parentId: 'C',
    },
  ],
  nodes: [
    { id: 'b1', label: 'b1', fields: [], position: { x: 0, y: 0 }, parentId: 'B' },
    { id: 'c1', label: 'c1', fields: [], position: { x: 0, y: 0 }, parentId: 'C' },
    { id: 'd1', label: 'd1', fields: [], position: { x: 0, y: 0 }, parentId: 'D' },
    { id: 'd2', label: 'd2', fields: [], position: { x: 0, y: 0 }, parentId: 'D' },
    { id: 'top', label: 'top', fields: [], position: { x: 0, y: 0 } },
  ],
  notes: [],
  edges: [],
  flows: [],
})

describe('layout-tree', () => {
  it('parentOf resolves node and group parents', () => {
    const d = mk()
    expect(parentOf(d, 'd1')).toBe('D')
    expect(parentOf(d, 'D')).toBe('C')
    expect(parentOf(d, 'top')).toBe(null)
    expect(parentOf(d, 'B')).toBe(null)
  })

  it('containerChain lists containers deepest-first ending in root(null)', () => {
    expect(containerChain(mk(), 'd1')).toEqual(['D', 'C', 'B', null])
    expect(containerChain(mk(), 'top')).toEqual([null])
  })

  it('lcaContainer is the deepest shared container', () => {
    const d = mk()
    expect(lcaContainer(d, 'd1', 'd2')).toBe('D') // same group
    expect(lcaContainer(d, 'c1', 'd1')).toBe('C') // c1 direct in C, d1 in D⊂C
    expect(lcaContainer(d, 'b1', 'd1')).toBe('B')
    expect(lcaContainer(d, 'top', 'd1')).toBe(null) // root
  })

  it('boxAtContainer returns the direct child of the container that holds the element', () => {
    const d = mk()
    expect(boxAtContainer(d, 'd1', 'C')).toBe('D') // via the child group
    expect(boxAtContainer(d, 'c1', 'C')).toBe('c1') // the node itself
    expect(boxAtContainer(d, 'd1', null)).toBe('B') // top-level box containing d1
  })

  it('contractEdges files each edge under its LCA as a box pair, dropping self-loops', () => {
    const d = mk()
    d.edges = [
      { id: 'e_dd', from: 'd1', to: 'd2', type: 'talks-to' }, // LCA D → d1↔d2
      { id: 'e_cd', from: 'c1', to: 'd1', type: 'talks-to' }, // LCA C → c1↔D
      { id: 'e_bd', from: 'b1', to: 'd1', type: 'talks-to' }, // LCA B → b1↔C
      { id: 'e_td', from: 'top', to: 'd1', type: 'talks-to' }, // LCA root → top↔B
    ]
    const m = contractEdges(d)
    expect(m.get('D')).toEqual([{ from: 'd1', to: 'd2' }])
    expect(m.get('C')).toEqual([{ from: 'c1', to: 'D' }])
    expect(m.get('B')).toEqual([{ from: 'b1', to: 'C' }])
    expect(m.get(null)).toEqual([{ from: 'top', to: 'B' }])
  })
})
