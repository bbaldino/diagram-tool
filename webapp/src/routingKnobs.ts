import { useSyncExternalStore } from 'react'
import { DEFAULT_ROUTING, type DiagramRouting, type PathfindingConfig } from '../shared/model'

// DEMO/experimental: the ACTIVE diagram's previewed routing config. App seeds it
// from the active diagram; the settings dialog edits it so edges re-route live;
// Apply commits it to the model. SmartTestEdge reads the pathfinding knobs here.

let state: DiagramRouting = DEFAULT_ROUTING
const listeners = new Set<() => void>()

export function getActiveRouting(): DiagramRouting {
  return state
}

export function setActiveRouting(routing: DiagramRouting): void {
  state = routing
  listeners.forEach((l) => l())
}

export function patchPathfinding(patch: Partial<PathfindingConfig>): void {
  setActiveRouting({ ...state, pathfinding: { ...state.pathfinding, ...patch } })
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useActiveRouting(): DiagramRouting {
  return useSyncExternalStore(subscribe, getActiveRouting, getActiveRouting)
}
