import type { DiagramContent } from '../src/model'

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
