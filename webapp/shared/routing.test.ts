import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUTING,
  effectiveRouting,
  setDiagramRouting,
  type Diagram,
  type Model,
} from './model'

function diagram(over: Partial<Diagram> = {}): Diagram {
  return {
    id: 'd1',
    name: 'D',
    title: 'D',
    type: 'topology',
    nodes: [],
    groups: [],
    notes: [],
    edges: [],
    flows: [],
    ...over,
  }
}

describe('effectiveRouting', () => {
  it('returns DEFAULT_ROUTING when the diagram has no override', () => {
    expect(effectiveRouting(diagram())).toEqual(DEFAULT_ROUTING)
  })

  it('returns the diagram override when present', () => {
    const routing = { ...DEFAULT_ROUTING, router: 'pathfinding' as const }
    expect(effectiveRouting(diagram({ routing }))).toEqual(routing)
  })
})

describe('DEFAULT_ROUTING', () => {
  it('defaults to the waypoint router with the tuned pathfinding baseline', () => {
    expect(DEFAULT_ROUTING.router).toBe('waypoint')
    expect(DEFAULT_ROUTING.pathfinding.algo).toBe('jump-point')
    expect(DEFAULT_ROUTING.pathfinding.draw).toBe('smoothstep')
    expect(DEFAULT_ROUTING.pathfinding.nodePadding).toBe(17)
  })
})

describe('setDiagramRouting', () => {
  it('sets routing on the target diagram only', () => {
    const model: Model = {
      version: 1,
      diagrams: [diagram({ id: 'a' }), diagram({ id: 'b' })],
      templates: [],
    }
    const routing = { ...DEFAULT_ROUTING, router: 'pathfinding' as const }
    const next = setDiagramRouting(model, 'a', routing)
    expect(next.diagrams.find((d) => d.id === 'a')?.routing).toEqual(routing)
    expect(next.diagrams.find((d) => d.id === 'b')?.routing).toBeUndefined()
  })
})

describe('separation knob', () => {
  it('defaults to 0', () => {
    expect(DEFAULT_ROUTING.pathfinding.separation).toBe(0)
  })
})
