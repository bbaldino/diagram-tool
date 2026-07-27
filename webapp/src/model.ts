import type { RelType, EdgeDir } from './graph'
export type { RelType }

export type Status = 'up' | 'down' | 'idle'
export type DiagramType = 'canvas' | 'topology' | 'call-flow'

export interface EntityField {
  key: string
  value: string
  showOnNode?: boolean
}
export interface TemplateField {
  key: string
  showOnNode?: boolean
  default?: string
}
export interface Template {
  id: string
  name: string
  icon?: string
  fields: TemplateField[]
}

export interface Entity {
  id: string
  label: string
  icon?: string
  sub?: string
  status?: Status
  kind?: 'actor'
  template?: string
  fields: EntityField[]
}
export interface Placement {
  entityId: string
  position: { x: number; y: number }
  parentId?: string | null // group id
  fieldShow?: Record<string, boolean>
  note?: string // inline note shown inside this entity's box, in THIS diagram only
}
export interface Group {
  id: string
  label: string
  color: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}
export type EdgeOrientation = 'auto' | 'horizontal' | 'vertical'

export interface DEdge {
  id: string
  from: string // entityId
  to: string // entityId
  type: RelType
  label?: string
  inferred?: boolean
  shape?: 'default' | 'smoothstep' | 'straight'
  points?: { x: number; y: number }[]
  sourceHandle?: string // which side of the source node ('top'|'right'|'bottom'|'left')
  targetHandle?: string // which side of the target node
  dir?: EdgeDir // arrowhead direction — forward (default) | backward | both
  color?: string // per-edge color override; falls back to the relationship type color
  labelPos?: number // fraction along the path in [0,1] where the label sits; absent = 0.5 (midpoint)
  orientation?: EdgeOrientation // routing axis hint; absent = 'auto' (geometry decides)
}
export interface Note {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  text: string
}
export interface FlowStep {
  id: string
  elementIds: string[]
  caption?: string
}
export interface Flow {
  id: string
  name: string
  steps: FlowStep[]
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
  flows?: Flow[]
}

// The undoable slice of a diagram (see undo/redo). Everything else on a
// Diagram (id/name/title/type) is identity, not content.
export interface DiagramContent {
  placements: Placement[]
  groups: Group[]
  edges: DEdge[]
  notes: Note[]
  flows: Flow[]
}

export function diagramContent(d: Diagram): DiagramContent {
  return { placements: d.placements, groups: d.groups, edges: d.edges, notes: d.notes, flows: d.flows ?? [] }
}

export interface Model {
  version: number
  entities: Entity[]
  diagrams: Diagram[]
  templates: Template[]
}

export function entitiesById(model: Model): Record<string, Entity> {
  return Object.fromEntries(model.entities.map((e) => [e.id, e]))
}

export function normalizeModel(m: any): Model {
  return {
    version: m.version ?? 1,
    templates: Array.isArray(m.templates) ? m.templates : [],
    entities: (m.entities ?? []).map((e: any) => ({ ...e, fields: Array.isArray(e.fields) ? e.fields : [] })),
    diagrams: m.diagrams ?? [],
  }
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
        fields: [],
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
    templates: [],
    entities,
    diagrams: [
      { id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas', placements, groups, edges: dedges, notes },
    ],
  }
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
  return model.entities.some((e) => e.id === entity.id)
    ? model
    : { ...model, entities: [...model.entities, entity] }
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

export function setPlacement(
  model: Model,
  diagramId: string,
  entityId: string,
  patch: Partial<Pick<Placement, 'position' | 'parentId' | 'note'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    placements: d.placements.map((p) => (p.entityId === entityId ? { ...p, ...patch } : p)),
  }))
}

export function addGroup(model: Model, diagramId: string, group: Group): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.groups.some((g) => g.id === group.id) ? d : { ...d, groups: [...d.groups, group] },
  )
}

export function updateGroup(model: Model, diagramId: string, id: string, patch: Partial<Omit<Group, 'id'>>): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch, id: g.id } : g)),
  }))
}

export function removeGroup(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    groups: d.groups.filter((g) => g.id !== id),
    placements: d.placements.map((p) => (p.parentId === id ? { ...p, parentId: undefined } : p)),
  }))
}

export function addFlow(model: Model, diagramId: string, flow: Flow): Model {
  return mapDiagram(model, diagramId, (d) =>
    (d.flows ?? []).some((f) => f.id === flow.id) ? d : { ...d, flows: [...(d.flows ?? []), flow] },
  )
}

export function updateFlow(model: Model, diagramId: string, id: string, patch: Partial<Omit<Flow, 'id'>>): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    flows: (d.flows ?? []).map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)),
  }))
}

export function removeFlow(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, flows: (d.flows ?? []).filter((f) => f.id !== id) }))
}

export function addNote(model: Model, diagramId: string, note: Note): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.notes.some((n) => n.id === note.id) ? d : { ...d, notes: [...d.notes, note] },
  )
}

export function updateNote(model: Model, diagramId: string, id: string, patch: Partial<Omit<Note, 'id'>>): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch, id: n.id } : n)),
  }))
}

export function removeNote(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }))
}

export function addEdge(model: Model, diagramId: string, edge: DEdge): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.edges.some((e) => e.id === edge.id) ? d : { ...d, edges: [...d.edges, edge] },
  )
}

export function updateEdge(model: Model, diagramId: string, id: string, patch: Partial<Omit<DEdge, 'id'>>): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)),
  }))
}

export function removeEdge(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) }))
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

export function fieldVisible(placement: Placement | undefined, entity: Entity, template: Template | undefined, key: string): boolean {
  const po = placement?.fieldShow?.[key]
  if (po !== undefined) return po
  const ef = entity.fields.find((f) => f.key === key)?.showOnNode
  if (ef !== undefined) return ef
  const tf = template?.fields.find((f) => f.key === key)?.showOnNode
  if (tf !== undefined) return tf
  return false
}

export function addTemplate(model: Model, name: string): { model: Model; id: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const existing = new Set(model.templates.map((t) => t.id))
  let id = `t-${slug}`
  for (let n = 2; existing.has(id); n++) id = `t-${slug}-${n}`
  const t: Template = { id, name, fields: [] }
  return { model: { ...model, templates: [...model.templates, t] }, id }
}

export function updateTemplate(model: Model, id: string, patch: Partial<Omit<Template, 'id'>>): Model {
  return { ...model, templates: model.templates.map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)) }
}

export function deleteTemplate(model: Model, id: string): Model {
  return {
    ...model,
    templates: model.templates.filter((t) => t.id !== id),
    entities: model.entities.map((e) => (e.template === id ? { ...e, template: undefined } : e)),
  }
}

export function applyTemplate(entity: Entity, template: Template): Entity {
  const have = new Set(entity.fields.map((f) => f.key))
  const added = template.fields.filter((tf) => !have.has(tf.key)).map((tf) => ({ key: tf.key, value: tf.default ?? '' }))
  return { ...entity, template: template.id, icon: entity.icon ?? template.icon, fields: [...entity.fields, ...added] }
}

export function setEntityFields(model: Model, entityId: string, fields: EntityField[]): Model {
  return { ...model, entities: model.entities.map((e) => (e.id === entityId ? { ...e, fields } : e)) }
}

export function setFieldShow(model: Model, diagramId: string, entityId: string, key: string, value: boolean | undefined): Model {
  return {
    ...model,
    diagrams: model.diagrams.map((d) =>
      d.id !== diagramId ? d : {
        ...d,
        placements: d.placements.map((p) => {
          if (p.entityId !== entityId) return p
          const fs = { ...(p.fieldShow ?? {}) }
          if (value === undefined) delete fs[key]
          else fs[key] = value
          return { ...p, fieldShow: fs }
        }),
      },
    ),
  }
}
