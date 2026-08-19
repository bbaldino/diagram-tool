import { useSyncExternalStore } from 'react'
import type { LabelPlacement } from './labelDeoverlap'

// Ephemeral, client-only: the auto de-collision pass's latest output, keyed by
// edge id. Never read by canvasToModel, so auto placement is never persisted.
let state = new Map<string, LabelPlacement>()
const listeners = new Set<() => void>()

export function setLabelPlacements(map: Map<string, LabelPlacement>): void {
  state = map
  listeners.forEach((l) => l())
}
export function getLabelPlacement(id: string): LabelPlacement | undefined {
  return state.get(id)
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useLabelPlacement(id: string): LabelPlacement | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state.get(id),
    () => state.get(id),
  )
}
