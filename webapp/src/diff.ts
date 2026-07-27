import type { Op } from './ops'
import type { Model, Diagram, Placement, Group, Note, DEdge, Flow, DiagramContent } from './model'
import { diagramContent } from './model'

const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b)

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function diffPlacements(diagramId: string, prev: Placement[], next: Placement[]): Op[] {
  const ops: Op[] = []
  const prevById = new Map(prev.map((p) => [p.entityId, p]))
  const nextById = new Map(next.map((p) => [p.entityId, p]))

  for (const p of prev) {
    if (!nextById.has(p.entityId)) ops.push({ t: 'placement.remove', diagramId, entityId: p.entityId })
  }
  for (const p of next) {
    const before = prevById.get(p.entityId)
    if (!before) {
      ops.push({ t: 'placement.add', diagramId, placement: p })
      continue
    }
    const patch: Partial<Pick<Placement, 'position' | 'parentId' | 'note'>> = {}
    if (changed(before.position, p.position)) patch.position = p.position
    if (changed(before.parentId, p.parentId)) patch.parentId = p.parentId
    if (changed(before.note, p.note)) patch.note = p.note
    if (Object.keys(patch).length > 0) ops.push({ t: 'placement.set', diagramId, entityId: p.entityId, patch })

    const beforeShow = before.fieldShow ?? {}
    const afterShow = p.fieldShow ?? {}
    const keys = new Set([...Object.keys(beforeShow), ...Object.keys(afterShow)])
    for (const key of keys) {
      const bv = beforeShow[key]
      const av = afterShow[key]
      if (bv !== av) ops.push({ t: 'placement.fieldShow', diagramId, entityId: p.entityId, key, value: av })
    }
  }
  return ops
}

function diffById<T extends { id: string }>(
  prev: T[],
  next: T[],
  addOp: (item: T) => Op,
  updateOp: (id: string, patch: Partial<Omit<T, 'id'>>) => Op,
  removeOp: (id: string) => Op,
): Op[] {
  const ops: Op[] = []
  const prevById = byId(prev)
  const nextById = byId(next)

  for (const item of prev) {
    if (!nextById.has(item.id)) ops.push(removeOp(item.id))
  }
  for (const item of next) {
    const before = prevById.get(item.id)
    if (!before) {
      ops.push(addOp(item))
      continue
    }
    if (changed(before, item)) {
      const { id, ...patch } = item as T & { id: string }
      ops.push(updateOp(id, patch as Partial<Omit<T, 'id'>>))
    }
  }
  return ops
}

export function diffDiagramContents(diagramId: string, prev: DiagramContent, next: DiagramContent): Op[] {
  const ops: Op[] = []
  ops.push(...diffPlacements(diagramId, prev.placements, next.placements))
  ops.push(
    ...diffById<Group>(
      prev.groups,
      next.groups,
      (g) => ({ t: 'group.add', diagramId, group: g }),
      (id, patch) => ({ t: 'group.update', diagramId, id, patch }),
      (id) => ({ t: 'group.remove', diagramId, id }),
    ),
  )
  ops.push(
    ...diffById<Note>(
      prev.notes,
      next.notes,
      (n) => ({ t: 'note.add', diagramId, note: n }),
      (id, patch) => ({ t: 'note.update', diagramId, id, patch }),
      (id) => ({ t: 'note.remove', diagramId, id }),
    ),
  )
  ops.push(
    ...diffById<DEdge>(
      prev.edges,
      next.edges,
      (e) => ({ t: 'edge.add', diagramId, edge: e }),
      (id, patch) => ({ t: 'edge.update', diagramId, id, patch }),
      (id) => ({ t: 'edge.remove', diagramId, id }),
    ),
  )
  ops.push(
    ...diffById<Flow>(
      prev.flows,
      next.flows,
      (f) => ({ t: 'flow.add', diagramId, flow: f }),
      (id, patch) => ({ t: 'flow.update', diagramId, id, patch }),
      (id) => ({ t: 'flow.remove', diagramId, id }),
    ),
  )
  return ops
}

export function diffToOps(prev: Model, next: Model): Op[] {
  const ops: Op[] = []

  // 1. Entities
  const prevEntities = byId(prev.entities)
  const nextEntities = byId(next.entities)
  for (const e of prev.entities) {
    if (!nextEntities.has(e.id)) ops.push({ t: 'entity.delete', id: e.id })
  }
  for (const e of next.entities) {
    const before = prevEntities.get(e.id)
    if (!before) {
      ops.push({ t: 'entity.add', entity: e })
    } else if (changed(before, e)) {
      const { id, ...patch } = e
      ops.push({ t: 'entity.update', id, patch })
    }
  }

  // 2. Templates
  const prevTemplates = byId(prev.templates)
  const nextTemplates = byId(next.templates)
  for (const t of prev.templates) {
    if (!nextTemplates.has(t.id)) ops.push({ t: 'template.delete', id: t.id })
  }
  for (const t of next.templates) {
    const before = prevTemplates.get(t.id)
    if (!before) {
      ops.push({ t: 'template.add', name: t.name })
      // template.add only creates { id, name, fields: [] } with no icon; emit a
      // follow-up update so icon/fields present on the brand-new template survive.
      const added = { id: t.id, name: t.name, fields: [] as typeof t.fields }
      if (changed(added, t)) {
        ops.push({ t: 'template.update', id: t.id, patch: { icon: t.icon, fields: t.fields } })
      }
    } else if (changed(before, t)) {
      const { id, ...patch } = t
      ops.push({ t: 'template.update', id, patch })
    }
  }

  // 3. Diagrams: add/rename/delete
  const prevDiagrams = byId(prev.diagrams)
  const nextDiagrams = byId(next.diagrams)
  for (const d of prev.diagrams) {
    if (!nextDiagrams.has(d.id)) ops.push({ t: 'diagram.delete', id: d.id })
  }
  for (const d of next.diagrams) {
    const before = prevDiagrams.get(d.id)
    if (!before) {
      ops.push({ t: 'diagram.add', name: d.name, kind: d.type })
    } else if (before.name !== d.name) {
      ops.push({ t: 'diagram.rename', id: d.id, name: d.name })
    }
  }

  // 4. Per-diagram contents: diagrams present in both diff against prev; brand-new
  // diagrams diff against an empty shell so their initial placements/groups/notes/edges
  // still get emitted (diagram.add only creates an empty diagram).
  for (const d of next.diagrams) {
    const before = prevDiagrams.get(d.id) ?? { ...d, placements: [], groups: [], edges: [], notes: [], flows: [] }
    ops.push(...diffDiagramContents(d.id, diagramContent(before), diagramContent(d)))
  }

  return ops
}
