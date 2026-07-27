import type { Flow } from './model'

export type FlowElemState = 'active' | 'lit'

// Element ids and their state at a given step (cumulative + moving highlight):
// ids in steps[stepIndex] are 'active'; ids in any earlier step (and not in the
// active set) are 'lit'. Ids not returned here are 'ghost' (the renderer's job).
export function flowStates(flow: Flow, stepIndex: number): Record<string, FlowElemState> {
  const out: Record<string, FlowElemState> = {}
  if (flow.steps.length === 0) return out
  const n = Math.max(0, Math.min(stepIndex, flow.steps.length - 1))
  for (let i = 0; i < n; i++) {
    for (const id of flow.steps[i].elementIds) out[id] = 'lit'
  }
  for (const id of flow.steps[n].elementIds) out[id] = 'active'
  return out
}
