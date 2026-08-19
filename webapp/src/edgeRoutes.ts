import { useSyncExternalStore } from 'react'

// Ephemeral, client-only: edge-aware routed paths (svg 'd'), keyed by edge id.
// Written by the useEdgeRouting coordinator; read by SmartTestEdge. Never read by
// canvasToModel, so these routes are never persisted.
let state = new Map<string, string>()
const listeners = new Set<() => void>()

export function setEdgeRoutes(map: Map<string, string>): void {
  state = map
  listeners.forEach((l) => l())
}
export function getEdgeRoute(id: string): string | undefined {
  return state.get(id)
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useEdgeRoute(id: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state.get(id),
    () => state.get(id),
  )
}
