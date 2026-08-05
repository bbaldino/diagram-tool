import * as M from './model'
import type { Model, Node, Field, Template, Group, Note, Edge, DiagramType, Flow } from './model'

export type Op =
  | { t: 'node.add'; diagramId: string; node: Node }
  | { t: 'node.update'; diagramId: string; id: string; patch: Partial<Omit<Node, 'id'>> }
  | { t: 'node.remove'; diagramId: string; id: string }
  | { t: 'node.setFields'; diagramId: string; id: string; fields: Field[] }
  | { t: 'node.applyTemplate'; diagramId: string; id: string; templateId: string }
  | { t: 'template.add'; name: string }
  | { t: 'template.update'; id: string; patch: Partial<Omit<Template, 'id'>> }
  | { t: 'template.delete'; id: string }
  | { t: 'diagram.add'; name: string; kind: DiagramType }
  | { t: 'diagram.rename'; id: string; name: string }
  | { t: 'diagram.delete'; id: string }
  | { t: 'group.add'; diagramId: string; group: Group }
  | { t: 'group.update'; diagramId: string; id: string; patch: Partial<Omit<Group, 'id'>> }
  | { t: 'group.remove'; diagramId: string; id: string }
  | { t: 'flow.add'; diagramId: string; flow: Flow }
  | { t: 'flow.update'; diagramId: string; id: string; patch: Partial<Omit<Flow, 'id'>> }
  | { t: 'flow.remove'; diagramId: string; id: string }
  | { t: 'note.add'; diagramId: string; note: Note }
  | { t: 'note.update'; diagramId: string; id: string; patch: Partial<Omit<Note, 'id'>> }
  | { t: 'note.remove'; diagramId: string; id: string }
  | { t: 'edge.add'; diagramId: string; edge: Edge }
  | { t: 'edge.update'; diagramId: string; id: string; patch: Partial<Omit<Edge, 'id'>> }
  | { t: 'edge.remove'; diagramId: string; id: string }

export function applyOp(model: Model, op: Op): Model {
  switch (op.t) {
    case 'node.add':
      return M.addNode(model, op.diagramId, op.node)
    case 'node.update':
      return M.updateNode(model, op.diagramId, op.id, op.patch)
    case 'node.remove':
      return M.removeNode(model, op.diagramId, op.id)
    case 'node.setFields':
      return M.setNodeFields(model, op.diagramId, op.id, op.fields)
    case 'node.applyTemplate': {
      const d = M.getDiagram(model, op.diagramId)
      const t = model.templates.find((x) => x.id === op.templateId)
      const n = d?.nodes.find((x) => x.id === op.id)
      if (!d || !t || !n) return model
      const { id, ...patch } = M.applyTemplate(n, t)
      return M.updateNode(model, op.diagramId, op.id, patch)
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
    case 'group.add':
      return M.addGroup(model, op.diagramId, op.group)
    case 'group.update':
      return M.updateGroup(model, op.diagramId, op.id, op.patch)
    case 'group.remove':
      return M.removeGroup(model, op.diagramId, op.id)
    case 'flow.add':
      return M.addFlow(model, op.diagramId, op.flow)
    case 'flow.update':
      return M.updateFlow(model, op.diagramId, op.id, op.patch)
    case 'flow.remove':
      return M.removeFlow(model, op.diagramId, op.id)
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
