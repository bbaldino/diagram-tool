import { describe, it, expect } from 'vitest'
import { backfillDefaults } from './model'
import { DEFAULT_EDGE_COLOR } from './relationships'
import { NEW_NODE_SCHEME, NEW_NOTE_SCHEME } from './schemes'

const model = (nodeScheme?: string, noteScheme?: string) =>
  ({
    version: 2,
    templates: [],
    diagrams: [
      {
        id: 'd',
        name: 'D',
        title: 'D',
        type: 'canvas',
        groups: [],
        edges: [],
        flows: [],
        nodes: [
          {
            id: 'n1',
            label: 'Plex',
            fields: [],
            position: { x: 0, y: 0 },
            ...(nodeScheme ? { scheme: nodeScheme } : {}),
          },
        ],
        notes: [
          {
            id: 't1',
            text: 'x',
            position: { x: 0, y: 0 },
            size: { width: 1, height: 1 },
            ...(noteScheme ? { scheme: noteScheme } : {}),
          },
        ],
      },
    ],
  }) as never

const read = (m: unknown) => {
  const d = (m as { diagrams: { nodes: { scheme?: string }[]; notes: { scheme?: string }[] }[] })
    .diagrams[0]
  return { node: d.nodes[0].scheme, note: d.notes[0].scheme }
}

describe('backfillDefaults', () => {
  it('gives a node with no scheme the node starting scheme', () => {
    expect(read(backfillDefaults(model())).node).toBe(NEW_NODE_SCHEME)
  })

  it('gives a note with no scheme the note starting scheme', () => {
    expect(read(backfillDefaults(model())).note).toBe(NEW_NOTE_SCHEME)
  })

  it('leaves an entity that already has one untouched, including a custom hex', () => {
    const out = read(backfillDefaults(model('#7c3aed', 'blue')))
    expect(out.node).toBe('#7c3aed')
    expect(out.note).toBe('blue')
  })

  it('is idempotent — a second run changes nothing', () => {
    const once = backfillDefaults(model())
    expect(backfillDefaults(once)).toEqual(once)
  })

  it('survives a diagram missing its collections rather than throwing', () => {
    const raw = {
      version: 2,
      templates: [],
      diagrams: [{ id: 'd1', name: 'D', title: 'D', type: 'canvas', groups: [], edges: [] }],
    } as never
    expect(() => backfillDefaults(raw)).not.toThrow()
    const d = (backfillDefaults(raw) as { diagrams: { nodes: unknown[]; notes: unknown[] }[] })
      .diagrams[0]
    expect(d.nodes).toEqual([])
    expect(d.notes).toEqual([])
  })

  it('tolerates a model with no diagrams key', () => {
    expect(() => backfillDefaults({ version: 2, templates: [] } as never)).not.toThrow()
  })
})

describe('backfillDefaults — edge colours', () => {
  const withEdges = (edges: unknown[]) =>
    ({
      version: 2,
      templates: [],
      diagrams: [
        {
          id: 'd1',
          name: 'D',
          title: 'D',
          type: 'canvas',
          nodes: [],
          groups: [],
          notes: [],
          edges,
        },
      ],
    }) as never

  const edgesOf = (m: unknown) =>
    (m as { diagrams: { edges: { color?: string }[] }[] }).diagrams[0]!.edges

  it('gives an edge with no colour the starting colour', () => {
    const out = edgesOf(
      backfillDefaults(withEdges([{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' }])),
    )
    expect(out[0]!.color).toBe(DEFAULT_EDGE_COLOR)
  })

  it('leaves an edge that already has a colour alone', () => {
    const out = edgesOf(
      backfillDefaults(
        withEdges([{ id: 'e1', from: 'a', to: 'b', type: 'talks-to', color: '#ff0000' }]),
      ),
    )
    expect(out[0]!.color).toBe('#ff0000')
  })

  it('is idempotent', () => {
    const once = backfillDefaults(withEdges([{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' }]))
    expect(backfillDefaults(once)).toEqual(once)
  })

  it('disturbs no other field on the edge', () => {
    const edge = {
      id: 'e1',
      from: 'a',
      to: 'b',
      type: 'talks-to',
      label: 'x',
      dir: 'both',
      inferred: true,
    }
    const out = edgesOf(backfillDefaults(withEdges([edge])))
    expect(out[0]).toMatchObject(edge)
  })

  // Same totality requirement as nodes and notes: a diagram missing its edges
  // array must not throw, because store.ts turns any load failure into an empty
  // model that autosave then persists over the real one.
  it('survives a diagram with no edges array', () => {
    const raw = {
      version: 2,
      templates: [],
      diagrams: [
        { id: 'd1', name: 'D', title: 'D', type: 'canvas', nodes: [], groups: [], notes: [] },
      ],
    } as never
    expect(() => backfillDefaults(raw)).not.toThrow()
    expect(edgesOf(backfillDefaults(raw))).toEqual([])
  })
})
