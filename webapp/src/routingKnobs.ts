import { useSyncExternalStore } from 'react'

// DEMO scaffolding: a tiny external store of the pathfinding-edge routing knobs,
// so the RoutingKnobsPanel can tweak them and every SmartTestEdge re-routes live
// (no server round-trip). Throwaway — lives only on the edge-routing branch.

export type PathAlgo = 'no-diagonal' | 'diagonal' | 'jump-point'
export type DrawStyle = 'stepped' | 'straight' | 'smoothstep' | 'spline'

export interface RoutingKnobs {
  algo: PathAlgo
  gridRatio: number
  nodePadding: number
  draw: DrawStyle
  eps: number // Douglas-Peucker tolerance (straight/spline only)
  obstacleGroups: boolean
  obstacleNotes: boolean
  directSkip: boolean // straight line when the direct path is already clear
}

export const DEFAULT_KNOBS: RoutingKnobs = {
  algo: 'no-diagonal',
  gridRatio: 12,
  nodePadding: 14,
  draw: 'straight',
  eps: 8,
  obstacleGroups: false,
  obstacleNotes: false,
  directSkip: false,
}

let state: RoutingKnobs = { ...DEFAULT_KNOBS }
const listeners = new Set<() => void>()

export function getRoutingKnobs(): RoutingKnobs {
  return state
}

export function setRoutingKnobs(patch: Partial<RoutingKnobs>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function resetRoutingKnobs(): void {
  setRoutingKnobs(DEFAULT_KNOBS)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useRoutingKnobs(): RoutingKnobs {
  return useSyncExternalStore(subscribe, getRoutingKnobs, getRoutingKnobs)
}
