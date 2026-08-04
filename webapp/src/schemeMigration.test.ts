import { describe, it, expect } from 'vitest'
import { backfillSchemes } from './model'
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

describe('backfillSchemes', () => {
  it('gives a node with no scheme the node starting scheme', () => {
    expect(read(backfillSchemes(model())).node).toBe(NEW_NODE_SCHEME)
  })

  it('gives a note with no scheme the note starting scheme', () => {
    expect(read(backfillSchemes(model())).note).toBe(NEW_NOTE_SCHEME)
  })

  it('leaves an entity that already has one untouched, including a custom hex', () => {
    const out = read(backfillSchemes(model('#7c3aed', 'blue')))
    expect(out.node).toBe('#7c3aed')
    expect(out.note).toBe('blue')
  })

  it('is idempotent — a second run changes nothing', () => {
    const once = backfillSchemes(model())
    expect(backfillSchemes(once)).toEqual(once)
  })

  it('survives a diagram missing its collections rather than throwing', () => {
    const raw = {
      version: 2,
      templates: [],
      diagrams: [{ id: 'd1', name: 'D', title: 'D', type: 'canvas', groups: [], edges: [] }],
    } as never
    expect(() => backfillSchemes(raw)).not.toThrow()
    const d = (backfillSchemes(raw) as { diagrams: { nodes: unknown[]; notes: unknown[] }[] })
      .diagrams[0]
    expect(d.nodes).toEqual([])
    expect(d.notes).toEqual([])
  })

  it('tolerates a model with no diagrams key', () => {
    expect(() => backfillSchemes({ version: 2, templates: [] } as never)).not.toThrow()
  })
})
