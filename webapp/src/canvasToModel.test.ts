import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { edgesToDiagramEdges, flushCanvasInto, nodesToDiagramParts } from './canvasToModel'
import type { AppEdge } from './canvasData'
import type { Model, Node as MNode, Edge as MEdge } from '../shared/model'

const svc = (id: string, data: Record<string, unknown>): Node =>
  ({ id, type: 'service', position: { x: 1, y: 2 }, data }) as Node
const grp = (id: string, data: Record<string, unknown>): Node =>
  ({
    id,
    type: 'group',
    position: { x: 3, y: 4 },
    data,
    style: { width: 400, height: 300 },
  }) as Node
const note = (id: string, data: Record<string, unknown>): Node =>
  ({ id, type: 'note', position: { x: 5, y: 6 }, data, style: { width: 200, height: 120 } }) as Node

describe('nodesToDiagramParts', () => {
  it('sorts each node kind into its own model array', () => {
    const out = nodesToDiagramParts(
      [
        svc('s1', { label: 'Plex' }),
        grp('g1', { label: 'G', color: '#64748b' }),
        note('t1', { text: 'hi' }),
      ],
      new Map(),
    )
    expect(out.nodes.map((n) => n.id)).toEqual(['s1'])
    expect(out.groups.map((n) => n.id)).toEqual(['g1'])
    expect(out.notes.map((n) => n.id)).toEqual(['t1'])
  })

  it('carries a service node data through to the model', () => {
    const [n] = nodesToDiagramParts(
      [
        svc('s1', {
          label: 'Plex',
          sub: ':32400',
          icon: 'plex',
          status: 'up',
          scheme: 'blue',
          kind: 'actor',
          note: 'hi',
        }),
      ],
      new Map(),
    ).nodes
    expect(n).toMatchObject({
      id: 's1',
      label: 'Plex',
      sub: ':32400',
      icon: 'plex',
      status: 'up',
      scheme: 'blue',
      actor: true,
      note: 'hi',
      position: { x: 1, y: 2 },
    })
  })

  // The canvas has no UI for fields or templates, so it never carries them.
  // Without this merge a geometry-only write-back — a drag — would silently
  // wipe both off every node it touched.
  it('restores fields and template from the previous model node', () => {
    const prev = new Map<string, MNode>([
      [
        's1',
        {
          id: 's1',
          label: 'Plex',
          fields: [{ key: 'port', value: '32400' }],
          template: 'tpl-1',
        } as MNode,
      ],
    ])
    const [n] = nodesToDiagramParts([svc('s1', { label: 'Plex' })], prev).nodes
    expect(n.fields).toEqual([{ key: 'port', value: '32400' }])
    expect(n.template).toBe('tpl-1')
  })

  it('gives a node with no previous entry an empty fields array, not undefined', () => {
    const [n] = nodesToDiagramParts([svc('s1', { label: 'Plex' })], new Map()).nodes
    expect(n.fields).toEqual([])
  })

  it('normalises empty strings to undefined so blanks are not persisted', () => {
    const [n] = nodesToDiagramParts(
      [svc('s1', { label: 'Plex', sub: '', icon: '', scheme: '' })],
      new Map(),
    ).nodes
    expect(n.sub).toBeUndefined()
    expect(n.icon).toBeUndefined()
    expect(n.scheme).toBeUndefined()
  })

  it('reads a group size from style when the canvas has not measured it', () => {
    const [g] = nodesToDiagramParts([grp('g1', { label: 'G', color: '#64748b' })], new Map()).groups
    expect(g.size).toEqual({ width: 400, height: 300 })
  })

  // A NodeResizer writes width/height and measured, but never style — reading
  // style alone dropped every resize.
  it('prefers the live measured size over style for a resized group', () => {
    const resized = {
      ...grp('g1', { label: 'G', color: '#64748b' }),
      width: 500,
      measured: { width: 500, height: 350 },
    } as Node
    const [g] = nodesToDiagramParts([resized], new Map()).groups
    expect(g.size.width).toBe(500)
  })

  it('defaults note text to an empty string rather than undefined', () => {
    const [t] = nodesToDiagramParts([note('t1', {})], new Map()).notes
    expect(t.text).toBe('')
  })
})

describe('edgesToDiagramEdges', () => {
  const edge = (data: Partial<AppEdge['data']> = {}): AppEdge =>
    ({ id: 'e1', source: 'a', target: 'b', data }) as AppEdge

  it('maps data fields onto the model edge', () => {
    const [e] = edgesToDiagramEdges(
      [
        edge({
          inferred: true,
          shape: 'straight',
          dir: 'both',
          color: '#ff0000',
          labelPos: 0.25,
        }),
      ],
      new Map(),
    )
    expect(e).toMatchObject({
      id: 'e1',
      from: 'a',
      to: 'b',
      inferred: true,
      shape: 'straight',
      dir: 'both',
      color: '#ff0000',
      labelPos: 0.25,
    })
  })

  it('falls back to sensible defaults when data is absent', () => {
    const [e] = edgesToDiagramEdges([{ id: 'e1', source: 'a', target: 'b' } as AppEdge], new Map())
    expect(e.shape).toBe('default')
    expect(e.dir).toBe('forward')
    expect(e.inferred).toBe(false)
  })

  // orientation is a server-side layout hint with no canvas UI, so like fields
  // and template it has to survive a write-back.
  it('preserves orientation from the previous model edge', () => {
    const prev = new Map<string, MEdge>([['e1', { id: 'e1', orientation: 'horizontal' } as MEdge]])
    const [e] = edgesToDiagramEdges([edge()], prev)
    expect(e.orientation).toBe('horizontal')
  })

  it('keeps a non-string label out of the model', () => {
    const [e] = edgesToDiagramEdges(
      [{ id: 'e1', source: 'a', target: 'b', label: 42 } as unknown as AppEdge],
      new Map(),
    )
    expect(e.label).toBeUndefined()
  })
})

describe('flushCanvasInto', () => {
  const model = (): Model =>
    ({
      version: 2,
      templates: [],
      diagrams: [
        {
          id: 'd1',
          name: 'D',
          title: 'D',
          type: 'canvas',
          nodes: [
            {
              id: 's1',
              label: 'Old',
              fields: [{ key: 'k', value: 'v' }],
              position: { x: 0, y: 0 },
            },
          ],
          groups: [],
          edges: [],
          notes: [],
          flows: [],
        },
      ],
    }) as unknown as Model

  it('writes the canvas into the named diagram', () => {
    const out = flushCanvasInto(model(), 'd1', [svc('s1', { label: 'New' })], [])
    expect(out.diagrams[0]!.nodes[0]!.label).toBe('New')
  })

  it('keeps fields that only exist in the model', () => {
    const out = flushCanvasInto(model(), 'd1', [svc('s1', { label: 'New' })], [])
    expect(out.diagrams[0]!.nodes[0]!.fields).toEqual([{ key: 'k', value: 'v' }])
  })

  it('leaves the model untouched when the diagram id is unknown', () => {
    const before = model()
    expect(flushCanvasInto(before, 'nope', [svc('s1', { label: 'New' })], [])).toEqual(before)
  })

  it('does not mutate the input model', () => {
    const before = model()
    const snapshot = JSON.stringify(before)
    flushCanvasInto(before, 'd1', [svc('s1', { label: 'New' })], [])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
