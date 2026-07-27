import * as M from './model'
import type { Model, Entity, EntityField, Template, Placement, Group, Note, DEdge, DiagramType } from './model'

export type Op =
  | { t: 'entity.add'; entity: Entity }
  | { t: 'entity.update'; id: string; patch: Partial<Omit<Entity, 'id'>> }
  | { t: 'entity.delete'; id: string }
  | { t: 'entity.setFields'; id: string; fields: EntityField[] }
  | { t: 'entity.applyTemplate'; id: string; templateId: string }
  | { t: 'template.add'; name: string }
  | { t: 'template.update'; id: string; patch: Partial<Omit<Template, 'id'>> }
  | { t: 'template.delete'; id: string }
  | { t: 'diagram.add'; name: string; kind: DiagramType }
  | { t: 'diagram.rename'; id: string; name: string }
  | { t: 'diagram.delete'; id: string }
  | { t: 'placement.add'; diagramId: string; placement: Placement }
  | { t: 'placement.remove'; diagramId: string; entityId: string }
  | { t: 'placement.set'; diagramId: string; entityId: string; patch: Partial<Pick<Placement, 'position' | 'parentId' | 'note'>> }
  | { t: 'placement.fieldShow'; diagramId: string; entityId: string; key: string; value: boolean | undefined }
  | { t: 'group.add'; diagramId: string; group: Group }
  | { t: 'group.update'; diagramId: string; id: string; patch: Partial<Omit<Group, 'id'>> }
  | { t: 'group.remove'; diagramId: string; id: string }
  | { t: 'note.add'; diagramId: string; note: Note }
  | { t: 'note.update'; diagramId: string; id: string; patch: Partial<Omit<Note, 'id'>> }
  | { t: 'note.remove'; diagramId: string; id: string }
  | { t: 'edge.add'; diagramId: string; edge: DEdge }
  | { t: 'edge.update'; diagramId: string; id: string; patch: Partial<Omit<DEdge, 'id'>> }
  | { t: 'edge.remove'; diagramId: string; id: string }

export function applyOp(model: Model, op: Op): Model {
  switch (op.t) {
    case 'entity.add':
      return M.addEntity(model, op.entity)
    case 'entity.update':
      return M.updateEntity(model, op.id, op.patch)
    case 'entity.delete':
      return M.deleteEntity(model, op.id)
    case 'entity.setFields':
      return M.setEntityFields(model, op.id, op.fields)
    case 'entity.applyTemplate': {
      const t = model.templates.find((x) => x.id === op.templateId)
      const e = model.entities.find((x) => x.id === op.id)
      if (!t || !e) return model
      return M.updateEntity(model, op.id, M.applyTemplate(e, t))
    }
    case 'template.add':
      return M.addTemplate(model, op.name).model
    case 'template.update':
      return M.updateTemplate(model, op.id, op.patch)
    case 'template.delete':
      return M.deleteTemplate(model, op.id)
    case 'diagram.add':
      return M.addDiagram(model, op.name, op.kind).model
    case 'diagram.rename':
      return M.renameDiagram(model, op.id, op.name)
    case 'diagram.delete':
      return M.deleteDiagram(model, op.id)
    case 'placement.add':
      return M.addPlacement(model, op.diagramId, op.placement)
    case 'placement.remove':
      return M.removePlacement(model, op.diagramId, op.entityId)
    case 'placement.set':
      return M.setPlacement(model, op.diagramId, op.entityId, op.patch)
    case 'placement.fieldShow':
      return M.setFieldShow(model, op.diagramId, op.entityId, op.key, op.value)
    case 'group.add':
      return M.addGroup(model, op.diagramId, op.group)
    case 'group.update':
      return M.updateGroup(model, op.diagramId, op.id, op.patch)
    case 'group.remove':
      return M.removeGroup(model, op.diagramId, op.id)
    case 'note.add':
      return M.addNote(model, op.diagramId, op.note)
    case 'note.update':
      return M.updateNote(model, op.diagramId, op.id, op.patch)
    case 'note.remove':
      return M.removeNote(model, op.diagramId, op.id)
    case 'edge.add':
      return M.addEdge(model, op.diagramId, op.edge)
    case 'edge.update':
      return M.updateEdge(model, op.diagramId, op.id, op.patch)
    case 'edge.remove':
      return M.removeEdge(model, op.diagramId, op.id)
    default:
      throw new Error('unknown op: ' + (op as { t: string }).t)
  }
}

export const applyOps = (model: Model, ops: Op[]): Model => ops.reduce(applyOp, model)
