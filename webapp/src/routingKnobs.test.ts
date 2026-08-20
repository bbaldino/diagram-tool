import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_ROUTING, DEFAULT_ELK } from '../shared/model'
import { getActiveRouting, setActiveRouting, patchPathfinding, patchElk } from './routingKnobs'

beforeEach(() => setActiveRouting(DEFAULT_ROUTING))

describe('active routing store', () => {
  it('starts at DEFAULT_ROUTING after seeding', () => {
    expect(getActiveRouting()).toEqual(DEFAULT_ROUTING)
  })

  it('patchPathfinding updates one knob without touching router', () => {
    setActiveRouting({ ...DEFAULT_ROUTING, router: 'pathfinding' })
    patchPathfinding({ nodePadding: 25 })
    expect(getActiveRouting().router).toBe('pathfinding')
    expect(getActiveRouting().pathfinding.nodePadding).toBe(25)
    expect(getActiveRouting().pathfinding.algo).toBe(DEFAULT_ROUTING.pathfinding.algo)
  })
})

describe('patchElk', () => {
  it('updates one ELK field, defaulting the rest, leaving router/pathfinding intact', () => {
    setActiveRouting({ ...DEFAULT_ROUTING, router: 'waypoint' })
    patchElk({ edgeEdge: 30 })
    const r = getActiveRouting()
    expect(r.router).toBe('waypoint')
    expect(r.elk?.edgeEdge).toBe(30)
    expect(r.elk?.direction).toBe(DEFAULT_ELK.direction)
    expect(r.pathfinding).toEqual(DEFAULT_ROUTING.pathfinding)
  })
})
