import type { RelType, EdgeDir } from './graph'
export type { RelType }

export type Status = 'up' | 'down' | 'idle'
export type DiagramType = 'canvas' | 'topology' | 'call-flow'
export type EdgeOrientation = 'auto' | 'horizontal' | 'vertical'

export interface Field {
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

// Base: pure identity (uuid). Every on-diagram object is one of these.
export interface Entity {
  id: string
}

export interface Node extends Entity {
  label: string
  icon?: string
  sub?: string
  status?: Status
  actor?: boolean // was Entity.kind === 'actor'
  template?: string // Template id
  fields: Field[]
  note?: string
  color?: string // per-entity accent colour (hex); absent = default styling
  position: { x: number; y: number }
  parentId?: string // containing Group id
}
export interface Group extends Entity {
  label: string
  color: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  parentId?: string
}
export interface Note extends Entity {
  text: string
  color?: string // sticky colour (hex); absent = default yellow
  position: { x: number; y: number }
  size: { width: number; height: number }
  parentId?: string
}
export interface Edge extends Entity {
  from: string // node id
  to: string // node id
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
  nodes: Node[]
  groups: Group[]
  notes: Note[]
  edges: Edge[]
  flows: Flow[]
}

// The undoable slice of a diagram (see undo/redo). Everything else on a
// Diagram (id/name/title/type) is identity, not content.
export interface DiagramContent {
  nodes: Node[]
  groups: Group[]
  notes: Note[]
  edges: Edge[]
  flows: Flow[]
}

export function diagramContent(d: Diagram): DiagramContent {
  return { nodes: d.nodes, groups: d.groups, notes: d.notes, edges: d.edges, flows: d.flows ?? [] }
}

export interface Model {
  version: number
  diagrams: Diagram[]
  templates: Template[]
}

export function nodesById(diagram: Diagram): Record<string, Node> {
  return Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
}

export function normalizeModel(m: any): Model {
  // Old catalog-shape models (top-level `entities`) are not migrated — the data
  // is disposable. Seed a fresh empty model instead.
  if (!m || Array.isArray(m.entities)) return { version: 2, diagrams: [], templates: [] }
  return {
    version: 2,
    templates: Array.isArray(m.templates) ? m.templates : [],
    diagrams: Array.isArray(m.diagrams) ? m.diagrams : [],
  }
}

export function getDiagram(model: Model, id: string): Diagram | undefined {
  return model.diagrams.find((d) => d.id === id)
}

function mapDiagram(model: Model, id: string, fn: (d: Diagram) => Diagram): Model {
  return { ...model, diagrams: model.diagrams.map((d) => (d.id === id ? fn(d) : d)) }
}

export function addNode(model: Model, diagramId: string, node: Node): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.nodes.some((n) => n.id === node.id) ? d : { ...d, nodes: [...d.nodes, node] },
  )
}

export function updateNode(
  model: Model,
  diagramId: string,
  id: string,
  patch: Partial<Omit<Node, 'id'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch, id: n.id } : n)),
  }))
}

export function removeNode(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    nodes: d.nodes.filter((n) => n.id !== id),
    edges: d.edges.filter((e) => e.from !== id && e.to !== id), // drop touching edges
  }))
}

export function setNodeFields(model: Model, diagramId: string, id: string, fields: Field[]): Model {
  return updateNode(model, diagramId, id, { fields })
}

export function applyTemplate(node: Node, template: Template): Node {
  const have = new Set(node.fields.map((f) => f.key))
  const added = template.fields
    .filter((tf) => !have.has(tf.key))
    .map((tf) => ({ key: tf.key, value: tf.default ?? '' }))
  return {
    ...node,
    template: template.id,
    icon: node.icon ?? template.icon,
    fields: [...node.fields, ...added],
  }
}

export function addGroup(model: Model, diagramId: string, group: Group): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.groups.some((g) => g.id === group.id) ? d : { ...d, groups: [...d.groups, group] },
  )
}

export function updateGroup(
  model: Model,
  diagramId: string,
  id: string,
  patch: Partial<Omit<Group, 'id'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch, id: g.id } : g)),
  }))
}

// Frees all child kinds — nodes, groups, and notes — that pointed at this
// group. Containment is now a generic parentId, not group-specific.
export function removeGroup(model: Model, diagramId: string, id: string): Model {
  const clear = <T extends { parentId?: string }>(xs: T[]) =>
    xs.map((x) => (x.parentId === id ? { ...x, parentId: undefined } : x))
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    groups: clear(d.groups.filter((g) => g.id !== id)),
    nodes: clear(d.nodes),
    notes: clear(d.notes),
  }))
}

export function addFlow(model: Model, diagramId: string, flow: Flow): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.flows.some((f) => f.id === flow.id) ? d : { ...d, flows: [...d.flows, flow] },
  )
}

export function updateFlow(
  model: Model,
  diagramId: string,
  id: string,
  patch: Partial<Omit<Flow, 'id'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    flows: d.flows.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)),
  }))
}

export function removeFlow(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, flows: d.flows.filter((f) => f.id !== id) }))
}

export function addNote(model: Model, diagramId: string, note: Note): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.notes.some((n) => n.id === note.id) ? d : { ...d, notes: [...d.notes, note] },
  )
}

export function updateNote(
  model: Model,
  diagramId: string,
  id: string,
  patch: Partial<Omit<Note, 'id'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch, id: n.id } : n)),
  }))
}

export function removeNote(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }))
}

export function addEdge(model: Model, diagramId: string, edge: Edge): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.edges.some((e) => e.id === edge.id) ? d : { ...d, edges: [...d.edges, edge] },
  )
}

export function updateEdge(
  model: Model,
  diagramId: string,
  id: string,
  patch: Partial<Omit<Edge, 'id'>>,
): Model {
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
  patch: Partial<Pick<Diagram, 'nodes' | 'groups' | 'edges' | 'notes' | 'name' | 'title'>>,
): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, ...patch }))
}

export function addDiagram(
  model: Model,
  name: string,
  type: DiagramType,
): { model: Model; id: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const base = `d-${slug}`
  const existing = new Set(model.diagrams.map((d) => d.id))
  let id = base
  for (let n = 2; existing.has(id); n++) id = `${base}-${n}`
  const d: Diagram = {
    id,
    name,
    title: name,
    type,
    nodes: [],
    groups: [],
    notes: [],
    edges: [],
    flows: [],
  }
  return { model: { ...model, diagrams: [...model.diagrams, d] }, id }
}

export function renameDiagram(model: Model, id: string, name: string): Model {
  return mapDiagram(model, id, (d) => ({ ...d, name, title: name }))
}

// Nodes are diagram-local now, so deleting a diagram is a plain filter — no
// cross-diagram sweep needed (that was only relevant to the old shared catalog).
export function deleteDiagram(model: Model, id: string): Model {
  return { ...model, diagrams: model.diagrams.filter((d) => d.id !== id) }
}

export function addTemplate(model: Model, name: string): { model: Model; id: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const existing = new Set(model.templates.map((t) => t.id))
  let id = `t-${slug}`
  for (let n = 2; existing.has(id); n++) id = `t-${slug}-${n}`
  const t: Template = { id, name, fields: [] }
  return { model: { ...model, templates: [...model.templates, t] }, id }
}

export function updateTemplate(
  model: Model,
  id: string,
  patch: Partial<Omit<Template, 'id'>>,
): Model {
  return {
    ...model,
    templates: model.templates.map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)),
  }
}

export function deleteTemplate(model: Model, id: string): Model {
  return {
    ...model,
    templates: model.templates.filter((t) => t.id !== id),
    diagrams: model.diagrams.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.template === id ? { ...n, template: undefined } : n)),
    })),
  }
}

export interface DiagramCounts {
  entities: number
  groups: number
  edges: number
  flows: number
  notes: number
}

export function diagramCounts(d: Diagram): DiagramCounts {
  return {
    entities: d.nodes.length,
    groups: d.groups.length,
    edges: d.edges.length,
    flows: d.flows.length,
    notes: d.notes.length,
  }
}

// Human copy for destructive-confirm bodies: "12 entities, 3 groups, 9 edges and
// 2 flows". Lists only non-zero categories (entities/groups/edges/flows — notes
// are not surfaced), pluralizes, and joins with commas + a trailing "and".
// Returns "no content" when everything is zero.
export function describeCounts(c: DiagramCounts): string {
  const parts: string[] = []
  const push = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`)
  }
  push(c.entities, 'entity', 'entities')
  push(c.groups, 'group', 'groups')
  push(c.edges, 'edge', 'edges')
  push(c.flows, 'flow', 'flows')
  if (parts.length === 0) return 'no content'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Clear a diagram's content but keep the diagram row (id/name/title/type).
// patchDiagram's patch type excludes `flows`, so this uses mapDiagram directly.
export function clearDiagram(model: Model, id: string): Model {
  return mapDiagram(model, id, (d) => ({
    ...d,
    nodes: [],
    groups: [],
    notes: [],
    edges: [],
    flows: [],
  }))
}

// Merge an imported model into this one as NEW diagrams: each imported diagram
// keeps its content but gets a collision-free id; imported templates are unioned
// by id. Returns the new model and the id of the first imported diagram (or null
// when the import has no diagrams).
export function mergeModel(
  model: Model,
  imported: Model,
): { model: Model; firstId: string | null } {
  const existing = new Set(model.diagrams.map((d) => d.id))
  const added: Diagram[] = []
  let firstId: string | null = null
  for (const d of imported.diagrams) {
    let id = d.id
    for (let n = 2; existing.has(id); n++) id = `${d.id}-${n}`
    existing.add(id)
    added.push({ ...d, id })
    if (firstId === null) firstId = id
  }
  const seenT = new Set(model.templates.map((t) => t.id))
  const templates = [...model.templates, ...imported.templates.filter((t) => !seenT.has(t.id))]
  return { model: { ...model, diagrams: [...model.diagrams, ...added], templates }, firstId }
}
