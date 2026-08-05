import type { DiagramContent } from '../shared/model'

export const HISTORY_LIMIT = 100

export interface DiagramHistory {
  entries: DiagramContent[]
  pointer: number
}
export type HistoryMap = Record<string, DiagramHistory>

const clone = (c: DiagramContent): DiagramContent => structuredClone(c)

export function seed(map: HistoryMap, diagramId: string, content: DiagramContent): HistoryMap {
  return { ...map, [diagramId]: { entries: [clone(content)], pointer: 0 } }
}

export function record(map: HistoryMap, diagramId: string, content: DiagramContent): HistoryMap {
  const h = map[diagramId]
  if (!h) return seed(map, diagramId, content)
  let entries = h.entries.slice(0, h.pointer + 1)
  entries.push(clone(content))
  if (entries.length > HISTORY_LIMIT) entries = entries.slice(entries.length - HISTORY_LIMIT)
  return { ...map, [diagramId]: { entries, pointer: entries.length - 1 } }
}

// Reconcile a diagram's persisted history against its current model content at
// startup. Unlike seed(), this NEVER discards an existing stack:
//   - no history yet           -> seed a single entry
//   - content == current head  -> unchanged (already aligned; the common case)
//   - content == some entry    -> move the pointer there (undo AND redo preserved)
//   - content matches no entry -> the model is ahead of history: an edit that was
//                                 never recorded (e.g. a mistimed save killed by a
//                                 restart). Append it as a new head, keeping the
//                                 whole prior stack as undo history rather than
//                                 throwing it away.
export function reconcile(map: HistoryMap, diagramId: string, content: DiagramContent): HistoryMap {
  const h = map[diagramId]
  if (!h || h.entries.length === 0) return seed(map, diagramId, content)
  const key = JSON.stringify(content)
  if (JSON.stringify(h.entries[h.pointer]) === key) return map
  const idx = h.entries.findIndex((e) => JSON.stringify(e) === key)
  if (idx >= 0) return setPointer(map, diagramId, idx)
  return record(map, diagramId, content)
}

export function dropDiagram(map: HistoryMap, diagramId: string): HistoryMap {
  if (!map[diagramId]) return map
  const next = { ...map }
  delete next[diagramId]
  return next
}

export function canUndo(map: HistoryMap, diagramId: string): boolean {
  const h = map[diagramId]
  return !!h && h.pointer > 0
}

export function canRedo(map: HistoryMap, diagramId: string): boolean {
  const h = map[diagramId]
  return !!h && h.pointer < h.entries.length - 1
}

export function undoTarget(
  map: HistoryMap,
  diagramId: string,
): { content: DiagramContent; pointer: number } | null {
  if (!canUndo(map, diagramId)) return null
  const h = map[diagramId]
  const pointer = h.pointer - 1
  return { content: clone(h.entries[pointer]), pointer }
}

export function redoTarget(
  map: HistoryMap,
  diagramId: string,
): { content: DiagramContent; pointer: number } | null {
  if (!canRedo(map, diagramId)) return null
  const h = map[diagramId]
  const pointer = h.pointer + 1
  return { content: clone(h.entries[pointer]), pointer }
}

export function setPointer(map: HistoryMap, diagramId: string, pointer: number): HistoryMap {
  const h = map[diagramId]
  if (!h) return map
  return { ...map, [diagramId]: { ...h, pointer } }
}

export function undoStates(
  map: HistoryMap,
): Record<string, { canUndo: boolean; canRedo: boolean }> {
  const out: Record<string, { canUndo: boolean; canRedo: boolean }> = {}
  for (const id of Object.keys(map)) {
    out[id] = { canUndo: canUndo(map, id), canRedo: canRedo(map, id) }
  }
  return out
}
