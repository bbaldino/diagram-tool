import type { EdgeDir } from '../src/graph'
import type { Diagram, DiagramType, EdgeOrientation, Entity, Group, Model, Placement } from '../src/model'
import { addDiagram, addEntity } from '../src/model'
import { diffToOps } from '../src/diff'
import type { Op } from '../src/ops'
import { layoutDiagram } from './layout'

export interface AuthorSpec {
  name: string
  type?: DiagramType // default 'canvas'
  nodes: (string | { new: string; icon?: string })[] // existing entity id, or new-by-label
  edges?: [string, string, { label?: string; dir?: EdgeDir; color?: string; orientation?: EdgeOrientation }?][] // [fromId,toId,attrs]
  groups?: { label: string; members: string[] }[] // members = entity ids
  notes?: Record<string, string> // entityId -> note
  positions?: Record<string, { x: number; y: number }> // optional agent overrides, entityId -> pos
}

const slugify = (s: string): string => {
  const slug = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  // Guard against degenerate ids: an all-symbol/whitespace label would yield
  // '' or a dash-only string. Fall back to a safe, non-empty id.
  return /[a-z0-9]/.test(slug) ? slug : 'entity'
}

// Assemble the ops that create the diagram (+ any new entities), laid out.
// Throws Error on an unresolvable existing entity id, an edge referencing a node id
// not in this diagram, or a group member id not in this diagram. Pure.
export async function authorDiagramOps(model: Model, spec: AuthorSpec): Promise<{ ops: Op[]; diagramId: string }> {
  let cloned: Model = model

  // Resolve/create entities, in spec.nodes order.
  const resolvedIds: string[] = []
  for (const node of spec.nodes) {
    if (typeof node === 'string') {
      if (!cloned.entities.some((e) => e.id === node)) {
        throw new Error(`authorDiagramOps: unknown entity id "${node}"`)
      }
      resolvedIds.push(node)
    } else {
      const id = slugify(node.new)
      resolvedIds.push(id)
      if (!cloned.entities.some((e) => e.id === id)) {
        const entity: Entity = { id, label: node.new, fields: [] }
        if (node.icon) entity.icon = node.icon
        cloned = addEntity(cloned, entity)
      }
    }
  }

  // Dedupe so exactly one placement is produced per resolved node id.
  const entityIds = [...new Set(resolvedIds)]
  const entityIdSet = new Set(entityIds)

  for (const [from, to] of spec.edges ?? []) {
    if (!entityIdSet.has(from)) {
      throw new Error(`authorDiagramOps: edge references unknown node id "${from}"`)
    }
    if (!entityIdSet.has(to)) {
      throw new Error(`authorDiagramOps: edge references unknown node id "${to}"`)
    }
  }

  for (const g of spec.groups ?? []) {
    for (const memberId of g.members) {
      if (!entityIdSet.has(memberId)) {
        throw new Error(`authorDiagramOps: group "${g.label}" references unknown node id "${memberId}"`)
      }
    }
  }

  const { model: withDiagram, id: diagramId } = addDiagram(cloned, spec.name, spec.type ?? 'canvas')
  cloned = withDiagram

  const placements: Placement[] = entityIds.map((entityId) => ({
    entityId,
    position: { x: 0, y: 0 },
    note: spec.notes?.[entityId],
  }))

  const groupIdByMember = new Map<string, string>()
  const groups: Group[] = (spec.groups ?? []).map((g, i) => {
    const id = `g-${slugify(g.label)}${i}`
    for (const memberId of g.members) groupIdByMember.set(memberId, id)
    return { id, label: g.label, color: '#64748b', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }
  })

  const placementsWithParents: Placement[] = placements.map((p) => {
    const parentId = groupIdByMember.get(p.entityId)
    return parentId ? { ...p, parentId } : p
  })

  const edges = (spec.edges ?? []).map(([from, to, attrs], i) => ({
    id: `e${i}-${from}-${to}`,
    from,
    to,
    type: 'talks-to' as const,
    ...attrs,
  }))

  const diagram: Diagram = {
    id: diagramId,
    name: spec.name,
    title: spec.name,
    type: spec.type ?? 'canvas',
    placements: placementsWithParents,
    groups,
    edges,
    notes: [],
  }

  const laidOut = await layoutDiagram(diagram)

  const finalPlacements: Placement[] = laidOut.placements.map((p) => {
    const override = spec.positions?.[p.entityId]
    return override ? { ...p, position: override } : p
  })

  const finalDiagram: Diagram = { ...diagram, placements: finalPlacements, groups: laidOut.groups, edges: laidOut.edges }

  cloned = {
    ...cloned,
    diagrams: cloned.diagrams.map((d) => (d.id === diagramId ? finalDiagram : d)),
  }

  return { ops: diffToOps(model, cloned), diagramId }
}
