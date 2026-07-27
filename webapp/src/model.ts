import type { RelType } from './graph'
import { makeEdge, restyleEdge } from './graph'
import { type Node, type Edge } from '@xyflow/react'
export type { RelType }

export type Status = 'up' | 'down' | 'idle'
export type DiagramType = 'canvas' | 'topology' | 'call-flow'

export interface Entity {
  id: string
  label: string
  icon?: string
  sub?: string
  status?: Status
  kind?: 'actor'
}
export interface Placement {
  entityId: string
  position: { x: number; y: number }
  parentId?: string | null // group id
}
export interface Group {
  id: string
  label: string
  color: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}
export interface DEdge {
  id: string
  from: string // entityId
  to: string // entityId
  type: RelType
  label?: string
  inferred?: boolean
  shape?: 'default' | 'smoothstep' | 'straight'
  points?: { x: number; y: number }[]
}
export interface Note {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  text: string
}
export interface Diagram {
  id: string
  name: string
  title: string
  type: DiagramType
  placements: Placement[]
  groups: Group[]
  edges: DEdge[]
  notes: Note[]
}
export interface Model {
  version: number
  entities: Entity[]
  diagrams: Diagram[]
}

export function entitiesById(model: Model): Record<string, Entity> {
  return Object.fromEntries(model.entities.map((e) => [e.id, e]))
}

export function migrateFromGraph(graph: any): Model {
  const nodes: any[] = graph?.nodes ?? []
  const edges: any[] = graph?.edges ?? []
  const entities: Entity[] = []
  const placements: Placement[] = []
  const groups: Group[] = []
  const notes: Note[] = []

  for (const n of nodes) {
    if (n.type === 'group') {
      groups.push({
        id: n.id,
        label: n.data?.label ?? 'Group',
        color: n.data?.color ?? '#64748b',
        position: n.position ?? { x: 0, y: 0 },
        size: {
          width: Number(n.style?.width) || 320,
          height: Number(n.style?.height) || 200,
        },
      })
    } else if (n.type === 'note') {
      notes.push({
        id: n.id,
        position: n.position ?? { x: 0, y: 0 },
        size: { width: Number(n.style?.width) || 190, height: Number(n.style?.height) || 110 },
        text: n.data?.text ?? '',
      })
    } else {
      // service or actor
      entities.push({
        id: n.id,
        label: n.data?.label ?? n.id,
        icon: n.data?.icon,
        sub: n.data?.sub,
        status: n.data?.status,
        kind: n.data?.kind,
      })
      placements.push({ entityId: n.id, position: n.position ?? { x: 0, y: 0 }, parentId: n.parentId ?? null })
    }
  }

  const dedges: DEdge[] = edges.map((e, i) => ({
    id: e.id ?? `e${i}-${e.source}-${e.target}`,
    from: e.source,
    to: e.target,
    type: (e.data?.rel as RelType) ?? 'talks-to',
    label: typeof e.label === 'string' ? e.label : undefined,
    inferred: !!e.data?.inferred,
    shape: e.data?.shape ?? 'default',
    points: e.data?.points,
  }))

  return {
    version: 1,
    entities,
    diagrams: [
      { id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas', placements, groups, edges: dedges, notes },
    ],
  }
}

export async function loadModel(): Promise<Model> {
  try {
    const res = await fetch('/api/model')
    if (res.status === 200) {
      const m = await res.json()
      if (m?.entities && m?.diagrams) return m as Model
    }
    // migrate from the old graph.json on first run
    const g = await fetch('/api/graph')
    if (g.status === 200) {
      const model = migrateFromGraph(await g.json())
      await saveModel(model)
      return model
    }
  } catch {
    // network error — fall through to the seed fallback below
  }
  return { version: 1, entities: [], diagrams: [{ id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas', placements: [], groups: [], edges: [], notes: [] }] }
}
export async function saveModel(model: Model): Promise<boolean> {
  try {
    const res = await fetch('/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model, null, 2) })
    return res.ok
  } catch {
    return false
  }
}

export function buildDiagramGraph(diagram: Diagram, byId: Record<string, Entity>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  // groups first (parents before children)
  for (const g of diagram.groups) {
    nodes.push({
      id: g.id,
      type: 'group',
      position: g.position,
      data: { label: g.label, color: g.color },
      style: { width: g.size.width, height: g.size.height },
    })
  }
  for (const p of diagram.placements) {
    const e = byId[p.entityId]
    if (!e) continue // entity deleted from catalog; skip stale placement
    nodes.push({
      id: e.id,
      type: 'service',
      position: p.position,
      parentId: p.parentId ?? undefined,
      extent: p.parentId ? 'parent' : undefined,
      data: { label: e.label, sub: e.sub, icon: e.icon, status: e.status, kind: e.kind },
    })
  }
  for (const n of diagram.notes) {
    nodes.push({ id: n.id, type: 'note', position: n.position, data: { text: n.text }, style: { width: n.size.width, height: n.size.height }, zIndex: 5 })
  }
  const edges: Edge[] = diagram.edges.map((de, i) => {
    let edge = makeEdge(de.from, de.to, de.type, de.label, de.inferred, i)
    edge.id = de.id
    edge.data = { ...edge.data, shape: de.shape ?? 'default', points: de.points }
    edge = restyleEdge(edge, de.type, !!de.inferred) // keeps id/source/target/data via spread
    return edge
  })
  return { nodes, edges }
}

export function getDiagram(model: Model, id: string): Diagram | undefined {
  return model.diagrams.find((d) => d.id === id)
}

function mapDiagram(model: Model, id: string, fn: (d: Diagram) => Diagram): Model {
  return { ...model, diagrams: model.diagrams.map((d) => (d.id === id ? fn(d) : d)) }
}

export function updateEntity(model: Model, id: string, patch: Partial<Entity>): Model {
  return { ...model, entities: model.entities.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)) }
}

export function addEntity(model: Model, entity: Entity): Model {
  return { ...model, entities: [...model.entities, entity] }
}

export function deleteEntity(model: Model, id: string): Model {
  return {
    ...model,
    entities: model.entities.filter((e) => e.id !== id),
    diagrams: model.diagrams.map((d) => ({
      ...d,
      placements: d.placements.filter((p) => p.entityId !== id),
      edges: d.edges.filter((e) => e.from !== id && e.to !== id),
    })),
  }
}

export function addPlacement(model: Model, diagramId: string, placement: Placement): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.placements.some((p) => p.entityId === placement.entityId) ? d : { ...d, placements: [...d.placements, placement] },
  )
}

export function removePlacement(model: Model, diagramId: string, entityId: string): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    placements: d.placements.filter((p) => p.entityId !== entityId),
    edges: d.edges.filter((e) => e.from !== entityId && e.to !== entityId),
  }))
}

export function patchDiagram(
  model: Model,
  diagramId: string,
  patch: Partial<Pick<Diagram, 'placements' | 'groups' | 'edges' | 'notes' | 'name' | 'title'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, ...patch }))
}

export function addDiagram(model: Model, name: string, type: DiagramType): { model: Model; id: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const base = `d-${slug}`
  const existing = new Set(model.diagrams.map((d) => d.id))
  let id = base
  for (let n = 2; existing.has(id); n++) id = `${base}-${n}`
  const d: Diagram = { id, name, title: name, type, placements: [], groups: [], edges: [], notes: [] }
  return { model: { ...model, diagrams: [...model.diagrams, d] }, id }
}

export function renameDiagram(model: Model, id: string, name: string): Model {
  return mapDiagram(model, id, (d) => ({ ...d, name, title: name }))
}

export function deleteDiagram(model: Model, id: string): Model {
  return { ...model, diagrams: model.diagrams.filter((d) => d.id !== id) }
}
