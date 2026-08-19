import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_ROUTING } from '../shared/model'
import { getActiveRouting, setActiveRouting, patchPathfinding } from './routingKnobs'

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
