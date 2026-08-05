import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EdgeDir } from '../shared/relationships'
import type {
  Diagram,
  DiagramType,
  Edge,
  EdgeOrientation,
  Field,
  Group,
  Node,
  Note,
  Status,
} from '../shared/model'
import { addDiagram, getDiagram } from '../shared/model'
import { newId } from '../shared/ids'
import { applyOps, type Op } from '../shared/ops'
import { diffToOps } from '../shared/diff'
import { reflowContainment, placeInGroup, NODE_EST_SIZE } from '../shared/containment'
import { layoutDiagram, type LayoutEngine, type NodeSizes, DEFAULT_ENGINE } from './layout'
import { normalizeNoteText } from './noteText'
import { authorDiagramOps, type AuthorSpec } from './authoring'
import type { Store } from './store'
import { isSchemeName, isCustomHex } from '../shared/schemes'

// Guidance for every `icon` field. Icons are slugs from the dashboard-icons set
// (rendered as `<slug>.svg`); an unknown slug renders nothing, so agents must
// not invent one — omitting the field falls back to the entity name's initials.
const ICON_FIELD_DESC =
  'OPTIONAL icon slug from the dashboard-icons set (github.com/homarr-labs/dashboard-icons), ' +
  'e.g. "traefik", "plex", "postgresql", "nginx", "home-assistant", "grafana". Set this ONLY to a ' +
  'slug you are confident exists in that set — do NOT guess, invent, or derive one from the label. ' +
  "When unsure, omit it: the node then shows the entity name's initials, which looks better than a " +
  'missing icon.'

// ---------------------------------------------------------------------------
// Argument shapes for the write handlers.
// ---------------------------------------------------------------------------

export interface AddNodeArgs {
  diagramId: string
  label: string
  icon?: string
  status?: Status
  scheme?: string
  position?: { x: number; y: number }
  parentId?: string | null
}

export interface ConnectArgs {
  diagramId: string
  from: string
  to: string
  label?: string
  dir?: EdgeDir
  color?: string
  orientation?: EdgeOrientation
}

export interface EditEdgeArgs {
  diagramId: string
  edgeId: string
  patch: Partial<Pick<Edge, 'label' | 'dir' | 'color' | 'orientation'>>
}

export interface AddNoteArgs {
  diagramId: string
  text: string
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  scheme?: string
  parentId?: string | null
}

export interface EditNoteArgs {
  diagramId: string
  id: string
  patch: Partial<{
    text: string
    position: { x: number; y: number }
    size: { width: number; height: number }
    scheme: string
    parentId: string | null
  }>
}

export interface RemoveArgs {
  diagramId: string
  nodeId?: string
  edgeId?: string
  groupId?: string
  noteId?: string
}

export interface EditNodeArgs {
  diagramId: string
  id: string
  patch: Partial<{
    label: string
    icon: string
    sub: string
    status: Status
    actor: boolean
    fields: Field[]
    scheme: string
    parentId: string | null
  }>
}

export interface AddGroupArgs {
  diagramId: string
  label: string
  color?: string
  parentId?: string | null
  position?: { x: number; y: number }
  size?: { width: number; height: number }
}

export interface EditGroupArgs {
  diagramId: string
  id: string
  patch: Partial<{
    label: string
    color: string
    size: { width: number; height: number }
    parentId: string | null
  }>
}

type ErrorResult = { error: string }
type OkResult = { ok: true }

const err = (message: string): ErrorResult => ({ error: message })

// Apply ops, then reflow the diagram's containment (padding/sizing) and persist
// the result — so an MCP grouping/reparent lands padded+sized like a human edit.
// One op batch in, one diffed op batch out = one write (one store.apply call).
function applyWithReflow(store: Store, diagramId: string, ops: Op[]): void {
  const before = store.getState().model
  const stepped = applyOps(before, ops)
  const d = getDiagram(stepped, diagramId)
  const reflowed = d
    ? {
        ...stepped,
        diagrams: stepped.diagrams.map((x) => (x.id === diagramId ? reflowContainment(x) : x)),
      }
    : stepped
  store.apply(diffToOps(before, reflowed), 'mcp')
}

// Landing position for a child (node/group/note) newly parented into
// `groupId`, laid out relative to its new siblings via placeInGroup — same
// helper the on-canvas drag-to-nest path uses (App.tsx) — so an MCP reparent
// doesn't coincide with an existing sibling or the group's own title strip.
// Model `position` is interpreted relative to the parent once `parentId` is
// set (buildGraph.ts passes it straight through to React Flow), so this MUST
// run before applyWithReflow whenever a handler sets a non-null parentId.
function positionInGroup(
  diagram: Diagram,
  groupId: string,
  childId: string,
  childSize: { width: number; height: number },
): { x: number; y: number } {
  const siblingsOf = <
    T extends { id: string; parentId?: string; position: { x: number; y: number } },
  >(
    items: T[],
    sizeOf: (item: T) => { width: number; height: number },
  ) =>
    items
      .filter((x) => x.parentId === groupId && x.id !== childId)
      .map((x) => ({ position: x.position, size: sizeOf(x) }))
  const siblings = [
    ...siblingsOf(diagram.nodes, () => NODE_EST_SIZE),
    ...siblingsOf(diagram.groups, (g) => g.size),
    ...siblingsOf(diagram.notes, (n) => n.size),
  ]
  return placeInGroup(childSize, siblings)
}

// Transitive descendant group ids of `groupId` (via parentId), used to
// reject an edit_group reparent that would create a cycle — a group nested
// into itself or into one of its own descendants. Nodes/notes have no
// descendants, so editNode needs no equivalent guard.
function groupDescendants(diagram: Diagram, groupId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const g of diagram.groups) {
    if (g.parentId) childrenOf.set(g.parentId, [...(childrenOf.get(g.parentId) ?? []), g.id])
  }
  const out = new Set<string>()
  const stack = [...(childrenOf.get(groupId) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    stack.push(...(childrenOf.get(cur) ?? []))
  }
  return out
}

// A flow step's element reference: either an existing element id (node,
// edge, group, or note) or an edge specified by its endpoints.
export type ElementRef = string | { from: string; to: string }

// Resolve an ElementRef to a concrete element id within `diagram`. Throws if
// the ref does not match any element (used by handlers.authorFlow, which
// turns the throw into an ErrorResult).
export function resolveElementRef(diagram: Diagram, ref: ElementRef): string {
  if (typeof ref !== 'string') {
    const edge = diagram.edges.find((e) => e.from === ref.from && e.to === ref.to)
    if (!edge) throw new Error(`no edge from "${ref.from}" to "${ref.to}"`)
    return edge.id
  }
  const exists =
    diagram.nodes.some((n) => n.id === ref) ||
    diagram.edges.some((e) => e.id === ref) ||
    diagram.groups.some((g) => g.id === ref) ||
    diagram.notes.some((n) => n.id === ref)
  if (!exists) throw new Error(`unknown element "${ref}" in diagram "${diagram.id}"`)
  return ref
}

// ---------------------------------------------------------------------------
// Plain, unit-testable handler logic. NO MCP/transport dependency: each is a
// pure-ish function over the store — validate against getState().model, build
// Op[], and apply tagged as the 'mcp' writer. Reads never write.
// ---------------------------------------------------------------------------

export const handlers = {
  listNodes(
    store: Store,
    diagramId: string,
  ): { id: string; label: string; icon?: string; status?: string }[] | ErrorResult {
    const diagram = getDiagram(store.getState().model, diagramId)
    if (!diagram) return err(`unknown diagram "${diagramId}"`)
    return diagram.nodes.map((n) => ({ id: n.id, label: n.label, icon: n.icon, status: n.status }))
  },

  listDiagrams(store: Store): { id: string; name: string; type: string }[] {
    return store.getState().model.diagrams.map((d) => ({ id: d.id, name: d.name, type: d.type }))
  },

  getDiagram(store: Store, id: string): Diagram | ErrorResult {
    const d = getDiagram(store.getState().model, id)
    return d ?? err(`unknown diagram "${id}"`)
  },

  // Mints a brand-new, empty diagram. addDiagram (the model mutator) mints the
  // id itself (a slug like `d-<slug>`, not a uuid — diagrams are slug-ided),
  // so the id is read back from its return value rather than the applied op;
  // the resulting model is diffed against the prior one so it's still a
  // single store.apply/write.
  newDiagram(store: Store, a: { name: string; type?: DiagramType }): { id: string } {
    const before = store.getState().model
    const { model, id } = addDiagram(before, a.name, a.type ?? 'canvas')
    store.apply(diffToOps(before, model), 'mcp')
    return { id }
  },

  renameDiagram(store: Store, a: { id: string; name: string }): OkResult | ErrorResult {
    if (!getDiagram(store.getState().model, a.id)) return err(`unknown diagram "${a.id}"`)
    store.apply([{ t: 'diagram.rename', id: a.id, name: a.name }], 'mcp')
    return { ok: true }
  },

  deleteDiagram(store: Store, a: { id: string }): OkResult | ErrorResult {
    if (!getDiagram(store.getState().model, a.id)) return err(`unknown diagram "${a.id}"`)
    store.apply([{ t: 'diagram.delete', id: a.id }], 'mcp')
    return { ok: true }
  },

  async authorDiagram(
    store: Store,
    spec: AuthorSpec,
  ): Promise<{ diagramId: string; nodeIds: string[] } | ErrorResult> {
    const model = store.getState().model
    let built: { ops: Op[]; diagramId: string; nodeIds: string[] }
    try {
      built = await authorDiagramOps(model, spec)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
    store.apply(built.ops, 'mcp')
    return { diagramId: built.diagramId, nodeIds: built.nodeIds }
  },

  addNode(store: Store, a: AddNodeArgs): { id: string } | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (typeof a.parentId === 'string' && !diagram.groups.some((grp) => grp.id === a.parentId)) {
      return err(`unknown group id "${a.parentId}"`)
    }
    const node: Node = {
      id: newId(),
      label: a.label,
      fields: [],
      position: a.position ?? { x: 0, y: 0 },
    }
    if (a.icon !== undefined) node.icon = a.icon
    if (a.status !== undefined) node.status = a.status
    if (a.scheme !== undefined) node.scheme = a.scheme
    if (a.parentId) {
      node.parentId = a.parentId
      if (a.position === undefined)
        node.position = positionInGroup(diagram, a.parentId, node.id, NODE_EST_SIZE)
      applyWithReflow(store, a.diagramId, [{ t: 'node.add', diagramId: a.diagramId, node }])
      return { id: node.id }
    }
    store.apply([{ t: 'node.add', diagramId: a.diagramId, node }], 'mcp')
    return { id: node.id }
  },

  connect(store: Store, a: ConnectArgs): { id: string } | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    // Any on-diagram element can be an edge endpoint, not just a service node:
    // NoteNode and GroupNode render the same four connection handles that
    // ServiceNode does, so the canvas has always allowed connecting notes and
    // groups. Restricting this to `nodes` made the MCP surface stricter than
    // both the model (Edge.from/to are plain ids) and the UI.
    const isEndpoint = (id: string): boolean =>
      diagram.nodes.some((n) => n.id === id) ||
      diagram.notes.some((n) => n.id === id) ||
      diagram.groups.some((g) => g.id === id)
    if (!isEndpoint(a.from)) {
      return err(`unknown element "${a.from}" in diagram "${a.diagramId}"`)
    }
    if (!isEndpoint(a.to)) {
      return err(`unknown element "${a.to}" in diagram "${a.diagramId}"`)
    }
    const edge: Edge = { id: newId(), from: a.from, to: a.to, type: 'talks-to' }
    if (a.label !== undefined) edge.label = a.label
    if (a.dir !== undefined) edge.dir = a.dir
    if (a.color !== undefined) edge.color = a.color
    if (a.orientation !== undefined) edge.orientation = a.orientation
    store.apply([{ t: 'edge.add', diagramId: a.diagramId, edge }], 'mcp')
    return { id: edge.id }
  },

  editEdge(store: Store, a: EditEdgeArgs): OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.edges.some((e) => e.id === a.edgeId)) {
      return err(`unknown edge "${a.edgeId}" in diagram "${a.diagramId}"`)
    }
    store.apply([{ t: 'edge.update', diagramId: a.diagramId, id: a.edgeId, patch: a.patch }], 'mcp')
    return { ok: true }
  },

  // Creates a new sticky note (Note entity) on the diagram. There is no more
  // per-node inline note; notes are their own top-level element now.
  addNote(store: Store, a: AddNoteArgs): { id: string } | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (a.parentId != null && !diagram.groups.some((g) => g.id === a.parentId)) {
      return err(`unknown group "${a.parentId}"`)
    }
    const note: Note = {
      id: newId(),
      text: normalizeNoteText(a.text),
      position: a.position ?? { x: 0, y: 0 },
      size: a.size ?? { width: 160, height: 90 },
    }
    if (a.scheme !== undefined) note.scheme = a.scheme
    if (a.parentId) {
      note.parentId = a.parentId
      if (a.position === undefined)
        note.position = positionInGroup(diagram, a.parentId, note.id, note.size)
      applyWithReflow(store, a.diagramId, [{ t: 'note.add', diagramId: a.diagramId, note }])
      return { id: note.id }
    }
    store.apply([{ t: 'note.add', diagramId: a.diagramId, note }], 'mcp')
    return { id: note.id }
  },

  // Updates an existing note by id. Reparenting (patch.parentId set to a
  // group) positions the note via positionInGroup and reflows containment,
  // same as editNode/editGroup.
  editNote(store: Store, a: EditNoteArgs): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    const note = diagram.notes.find((n) => n.id === a.id)
    if (!note) return err(`unknown note "${a.id}" in diagram "${a.diagramId}"`)
    if (a.patch.parentId != null && !diagram.groups.some((g) => g.id === a.patch.parentId)) {
      return err(`unknown group "${a.patch.parentId}"`)
    }
    const touchesContainment = 'parentId' in a.patch
    const { parentId, scheme, ...rest } = a.patch
    const patch: Partial<Omit<Note, 'id'>> = { ...rest }
    if (typeof rest.text === 'string') patch.text = normalizeNoteText(rest.text)
    if (scheme !== undefined) patch.scheme = scheme
    if (touchesContainment) {
      patch.parentId = parentId ?? undefined
      if (parentId != null)
        patch.position = positionInGroup(diagram, parentId, a.id, a.patch.size ?? note.size)
    }
    const op: Op = { t: 'note.update', diagramId: a.diagramId, id: a.id, patch }
    if (touchesContainment) applyWithReflow(store, a.diagramId, [op])
    else store.apply([op], 'mcp')
    return { ok: true }
  },

  remove(store: Store, a: RemoveArgs): OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)

    const ops: Op[] = []
    if (a.edgeId !== undefined) {
      if (!diagram.edges.some((e) => e.id === a.edgeId)) return err(`unknown edge "${a.edgeId}"`)
      ops.push({ t: 'edge.remove', diagramId: a.diagramId, id: a.edgeId })
    }
    if (a.groupId !== undefined) {
      if (!diagram.groups.some((g) => g.id === a.groupId))
        return err(`unknown group "${a.groupId}"`)
      ops.push({ t: 'group.remove', diagramId: a.diagramId, id: a.groupId })
    }
    if (a.noteId !== undefined) {
      if (!diagram.notes.some((n) => n.id === a.noteId)) return err(`unknown note "${a.noteId}"`)
      ops.push({ t: 'note.remove', diagramId: a.diagramId, id: a.noteId })
    }
    if (a.nodeId !== undefined) {
      if (!diagram.nodes.some((n) => n.id === a.nodeId)) {
        return err(`unknown node "${a.nodeId}" in diagram "${a.diagramId}"`)
      }
      ops.push({ t: 'node.remove', diagramId: a.diagramId, id: a.nodeId })
    }
    if (ops.length === 0) return err('remove: specify one of nodeId, edgeId, groupId, or noteId')
    store.apply(ops, 'mcp')
    return { ok: true }
  },

  editNode(store: Store, a: EditNodeArgs): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.nodes.some((n) => n.id === a.id))
      return err(`unknown node "${a.id}" in diagram "${a.diagramId}"`)
    if (a.patch.parentId != null && !diagram.groups.some((g) => g.id === a.patch.parentId)) {
      return err(`unknown group "${a.patch.parentId}"`)
    }
    const touchesContainment = 'parentId' in a.patch
    const { parentId, scheme, ...rest } = a.patch
    const patch: Partial<Omit<Node, 'id'>> = { ...rest }
    if (scheme !== undefined) patch.scheme = scheme
    if (touchesContainment) {
      patch.parentId = parentId ?? undefined
      if (parentId != null) patch.position = positionInGroup(diagram, parentId, a.id, NODE_EST_SIZE)
    }
    const op: Op = { t: 'node.update', diagramId: a.diagramId, id: a.id, patch }
    if (touchesContainment) applyWithReflow(store, a.diagramId, [op])
    else store.apply([op], 'mcp')
    return { ok: true }
  },

  addGroup(store: Store, a: AddGroupArgs): { id: string } | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (a.parentId != null && !diagram.groups.some((g) => g.id === a.parentId)) {
      return err(`unknown group "${a.parentId}"`)
    }
    const group: Group = {
      id: newId(),
      label: a.label,
      color: a.color ?? '#64748b',
      position: a.position ?? { x: 40, y: 40 },
      size: a.size ?? { width: 320, height: 200 },
    }
    if (a.parentId) {
      group.parentId = a.parentId
      if (a.position === undefined)
        group.position = positionInGroup(diagram, a.parentId, group.id, group.size)
    }
    applyWithReflow(store, a.diagramId, [{ t: 'group.add', diagramId: a.diagramId, group }])
    return { id: group.id }
  },

  editGroup(store: Store, a: EditGroupArgs): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    const group = diagram.groups.find((g) => g.id === a.id)
    if (!group) return err(`unknown group "${a.id}" in diagram "${a.diagramId}"`)
    if (a.patch.parentId != null) {
      if (!diagram.groups.some((g) => g.id === a.patch.parentId))
        return err(`unknown group "${a.patch.parentId}"`)
      if (a.patch.parentId === a.id || groupDescendants(diagram, a.id).has(a.patch.parentId)) {
        return err('cannot parent a group into itself or a descendant')
      }
    }
    const touchesParent = 'parentId' in a.patch
    const { parentId, ...rest } = a.patch
    const patch: Partial<Omit<Group, 'id'>> = { ...rest }
    if (touchesParent) {
      patch.parentId = parentId ?? undefined
      if (parentId != null)
        patch.position = positionInGroup(diagram, parentId, a.id, a.patch.size ?? group.size)
    }
    applyWithReflow(store, a.diagramId, [
      { t: 'group.update', diagramId: a.diagramId, id: a.id, patch },
    ])
    return { ok: true }
  },

  async layout(
    store: Store,
    diagramId: string,
    engine: LayoutEngine = DEFAULT_ENGINE,
    // Client-measured node heights. Absent on an MCP call (no browser to
    // measure), in which case the engine falls back to its default box.
    sizes?: NodeSizes,
  ): Promise<OkResult | ErrorResult> {
    const model = store.getState().model
    const diagram = getDiagram(model, diagramId)
    if (!diagram) return err(`unknown diagram "${diagramId}"`)
    const laid = await layoutDiagram(diagram, engine, sizes)
    const nextDiagram: Diagram = {
      ...diagram,
      nodes: laid.nodes,
      groups: laid.groups,
      notes: laid.notes,
      edges: laid.edges,
    }
    const nextModel = {
      ...model,
      diagrams: model.diagrams.map((d) => (d.id === diagramId ? nextDiagram : d)),
    }
    store.apply(diffToOps(model, nextModel), 'mcp')
    return { ok: true }
  },

  authorFlow(
    store: Store,
    a: { diagramId: string; name: string; steps: { elements: ElementRef[]; caption?: string }[] },
  ): { flowId: string } | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    let steps
    try {
      steps = a.steps.map((s, i) => ({
        id: `step-${i}-${Date.now().toString(36)}`,
        elementIds: s.elements.map((r) => resolveElementRef(diagram, r)),
        caption: s.caption,
      }))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
    const flowId = `flow-${Date.now().toString(36)}`
    store.apply(
      [{ t: 'flow.add', diagramId: a.diagramId, flow: { id: flowId, name: a.name, steps } }],
      'mcp',
    )
    return { flowId }
  },

  addFlowStep(
    store: Store,
    a: {
      diagramId: string
      flowId: string
      elements: ElementRef[]
      caption?: string
      index?: number
    },
  ): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    const flow = diagram.flows?.find((f) => f.id === a.flowId)
    if (!flow) return err(`unknown flow "${a.flowId}"`)
    let elementIds
    try {
      elementIds = a.elements.map((r) => resolveElementRef(diagram, r))
    } catch (e) {
      return err(String(e instanceof Error ? e.message : e))
    }
    const step = { id: `step-${Date.now().toString(36)}`, elementIds, caption: a.caption }
    const steps = flow.steps.slice()
    steps.splice(a.index ?? steps.length, 0, step)
    store.apply(
      [{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps } }],
      'mcp',
    )
    return { ok: true }
  },

  setFlowStep(
    store: Store,
    a: {
      diagramId: string
      flowId: string
      stepId: string
      patch: { elements?: ElementRef[]; caption?: string }
    },
  ): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    const flow = diagram.flows?.find((f) => f.id === a.flowId)
    if (!flow) return err(`unknown flow "${a.flowId}"`)
    if (!flow.steps.some((s) => s.id === a.stepId)) return err(`unknown step "${a.stepId}"`)
    let resolved: string[] | undefined
    try {
      resolved = a.patch.elements?.map((r) => resolveElementRef(diagram, r))
    } catch (e) {
      return err(String(e instanceof Error ? e.message : e))
    }
    const steps = flow.steps.map((s) =>
      s.id !== a.stepId
        ? s
        : {
            ...s,
            ...(resolved ? { elementIds: resolved } : {}),
            ...(a.patch.caption !== undefined ? { caption: a.patch.caption } : {}),
          },
    )
    store.apply(
      [{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps } }],
      'mcp',
    )
    return { ok: true }
  },

  removeFlowStep(
    store: Store,
    a: { diagramId: string; flowId: string; stepId: string },
  ): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    const flow = diagram.flows?.find((f) => f.id === a.flowId)
    if (!flow) return err(`unknown flow "${a.flowId}"`)
    if (!flow.steps.some((s) => s.id === a.stepId)) return err(`unknown step "${a.stepId}"`)
    store.apply(
      [
        {
          t: 'flow.update',
          diagramId: a.diagramId,
          id: a.flowId,
          patch: { steps: flow.steps.filter((s) => s.id !== a.stepId) },
        },
      ],
      'mcp',
    )
    return { ok: true }
  },

  renameFlow(
    store: Store,
    a: { diagramId: string; flowId: string; name: string },
  ): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.flows?.some((f) => f.id === a.flowId)) return err(`unknown flow "${a.flowId}"`)
    store.apply(
      [{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { name: a.name } }],
      'mcp',
    )
    return { ok: true }
  },

  deleteFlow(store: Store, a: { diagramId: string; flowId: string }): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.flows?.some((f) => f.id === a.flowId)) return err(`unknown flow "${a.flowId}"`)
    store.apply([{ t: 'flow.remove', diagramId: a.diagramId, id: a.flowId }], 'mcp')
    return { ok: true }
  },
}

// ---------------------------------------------------------------------------
// MCP registration wrapper. Thin: every tool callback delegates to the plain
// handler above and serializes the result as a text content block.
// ---------------------------------------------------------------------------

export const wrap = (result: unknown) => {
  const content = [{ type: 'text' as const, text: JSON.stringify(result) }]
  const isError = typeof result === 'object' && result !== null && 'error' in result
  return isError ? { content, isError: true } : { content }
}

const positionShape = z.object({ x: z.number(), y: z.number() })

// Shared shape for the fields an agent may set on an edge. Relationship
// `type` is intentionally excluded: it's vestigial (edges are distinguished
// by color/label; new edges default to 'talks-to') and an unconstrained
// string here would let a bad value flow into Edge.type and throw in the
// renderer (REL[type].color). Exported so it's independently testable.
export const edgeAttrsShape = {
  label: z.string().optional(),
  dir: z.enum(['forward', 'backward', 'both']).optional(),
  color: z.string().optional(),
  orientation: z.enum(['auto', 'horizontal', 'vertical']).optional(),
}

// A scheme name or a custom 6-digit hex. Rejected at the boundary so a typo is
// refused rather than stored and silently falling back at render.
export const schemeShape = z
  .string()
  .refine((v) => isSchemeName(v) || isCustomHex(v), {
    message: 'scheme must be a known scheme name or a 6-digit hex like #3b82f6',
  })
  .optional()

// `color` was replaced by `scheme` on nodes and notes. zod's default object
// parsing silently strips unknown keys, so a bare omission here would let an
// agent send `color`, have it vanish with no error, and get back a success
// response for a request that did nothing. Reject it explicitly instead, with
// a message that names the replacement — added to add_node/add_note and the
// patch shapes of edit_node/edit_note. Groups still use `color` for real
// (out of scope here), so this is NOT added to add_group/edit_group.
const rejectedColorShape = z
  .any()
  .optional()
  .refine((v) => v === undefined, {
    message:
      '`color` is no longer accepted on nodes and notes — use `scheme`, which takes a scheme name (for example `blue` or `paper`) or a 6-digit hex like `#3b82f6`.',
  })

// spec.nodes entries mint brand-new nodes (uuid ids) — there is no catalog to
// resolve an "existing" node against. spec.edges/groups/positions refer back
// to a node minted earlier in the SAME call via a spec-local ref derived from
// its label (see authoring.ts); they are never the node's real id.
const authorSpecShape = {
  name: z.string(),
  type: z.enum(['canvas', 'topology', 'call-flow']).optional(),
  nodes: z.array(
    z.union([
      z.string(),
      z.object({ label: z.string(), icon: z.string().optional().describe(ICON_FIELD_DESC) }),
    ]),
  ),
  edges: z.array(z.tuple([z.string(), z.string(), z.object(edgeAttrsShape).optional()])).optional(),
  groups: z.array(z.object({ label: z.string(), members: z.array(z.string()) })).optional(),
  positions: z.record(z.string(), positionShape).optional(),
}

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer({ name: 'homelab-diagram', version: '0.1.0' })

  server.registerTool(
    'list_nodes',
    { description: 'List all nodes in a diagram.', inputSchema: { diagramId: z.string() } },
    (args) => wrap(handlers.listNodes(store, args.diagramId)),
  )

  server.registerTool(
    'list_diagrams',
    { description: 'List all diagrams (id, name, type).', inputSchema: {} },
    () => wrap(handlers.listDiagrams(store)),
  )

  server.registerTool(
    'get_diagram',
    { description: 'Get a single diagram by id.', inputSchema: { id: z.string() } },
    (args) => wrap(handlers.getDiagram(store, args.id)),
  )

  server.registerTool(
    'new_diagram',
    {
      description: 'Create a new, empty diagram. Returns the created diagram id.',
      inputSchema: {
        name: z.string(),
        type: z.enum(['canvas', 'topology', 'call-flow']).optional(),
      },
    },
    (args) => wrap(handlers.newDiagram(store, args)),
  )

  server.registerTool(
    'rename_diagram',
    {
      description: 'Rename an existing diagram.',
      inputSchema: { id: z.string(), name: z.string() },
    },
    (args) => wrap(handlers.renameDiagram(store, args)),
  )

  server.registerTool(
    'delete_diagram',
    { description: 'Delete a diagram.', inputSchema: { id: z.string() } },
    (args) => wrap(handlers.deleteDiagram(store, args)),
  )

  server.registerTool(
    'author_diagram',
    {
      description:
        'Create a new, automatically laid-out diagram from a high-level spec. Every entry in `nodes` mints a brand-new node; `edges`/`groups`/`positions` refer back to those nodes by a spec-local ref (the label, slugified — e.g. "Plex" -> "plex"), not by the node\'s real id. The result includes the diagram id and the created node uuids, in `nodes` order, for use in follow-up tool calls. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
      inputSchema: authorSpecShape,
    },
    async (args) => wrap(await handlers.authorDiagram(store, args as AuthorSpec)),
  )

  server.registerTool(
    'add_node',
    {
      description: 'Add a new node to a diagram. Returns the created node id.',
      inputSchema: {
        diagramId: z.string(),
        label: z.string(),
        icon: z.string().optional().describe(ICON_FIELD_DESC),
        status: z.enum(['up', 'down', 'idle']).optional(),
        scheme: schemeShape,
        color: rejectedColorShape,
        position: positionShape.optional(),
        parentId: z.string().nullable().optional(),
      },
    },
    (args) => wrap(handlers.addNode(store, args as AddNodeArgs)),
  )

  server.registerTool(
    'connect',
    {
      description:
        'Add an edge between two elements in a diagram. `from` and `to` may each be a node, a note, or a group — all three carry connection handles on the canvas, so a note can be tethered to the thing it annotates. Returns the created edge id. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
      inputSchema: {
        diagramId: z.string(),
        from: z.string(),
        to: z.string(),
        ...edgeAttrsShape,
      },
    },
    (args) => wrap(handlers.connect(store, args as ConnectArgs)),
  )

  server.registerTool(
    'edit_edge',
    {
      description:
        'Update an existing edge in a diagram. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
      inputSchema: {
        diagramId: z.string(),
        edgeId: z.string(),
        patch: z.object(edgeAttrsShape),
      },
    },
    (args) => wrap(handlers.editEdge(store, args as EditEdgeArgs)),
  )

  server.registerTool(
    'add_note',
    {
      description: 'Add a new sticky note to a diagram. Returns the created note id.',
      inputSchema: {
        diagramId: z.string(),
        text: z.string(),
        position: positionShape.optional(),
        size: z.object({ width: z.number(), height: z.number() }).optional(),
        scheme: schemeShape,
        color: rejectedColorShape,
        parentId: z.string().nullable().optional(),
      },
    },
    (args) => wrap(handlers.addNote(store, args as AddNoteArgs)),
  )

  server.registerTool(
    'edit_note',
    {
      description:
        "Update an existing note's text/position/size, and/or move it into or out of a group via parentId. Reparenting also reflows the target group's size/padding so the change lands like a human edit.",
      inputSchema: {
        diagramId: z.string(),
        id: z.string(),
        patch: z.object({
          text: z.string().optional(),
          position: positionShape.optional(),
          size: z.object({ width: z.number(), height: z.number() }).optional(),
          scheme: schemeShape,
          color: rejectedColorShape,
          parentId: z
            .string()
            .nullable()
            .optional()
            .describe('Set to a group id to move the note into that group, or null to un-parent.'),
        }),
      },
    },
    (args) => wrap(handlers.editNote(store, args as EditNoteArgs)),
  )

  server.registerTool(
    'remove',
    {
      description: 'Remove a node, edge, group, or note from a diagram.',
      inputSchema: {
        diagramId: z.string(),
        nodeId: z.string().optional(),
        edgeId: z.string().optional(),
        groupId: z.string().optional(),
        noteId: z.string().optional(),
      },
    },
    (args) => wrap(handlers.remove(store, args as RemoveArgs)),
  )

  const nodePatchShape = z.object({
    label: z.string().optional(),
    icon: z.string().optional().describe(ICON_FIELD_DESC),
    sub: z.string().optional(),
    status: z.enum(['up', 'down', 'idle']).optional(),
    actor: z.boolean().optional(),
    fields: z
      .array(z.object({ key: z.string(), value: z.string(), showOnNode: z.boolean().optional() }))
      .optional(),
    scheme: schemeShape,
    color: rejectedColorShape,
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe('Set to a group id to move the node into that group, or null to un-parent.'),
  })

  server.registerTool(
    'edit_node',
    {
      description:
        "Update an existing node's label/icon/sub/status/actor/fields, and/or move it into or out of a group via parentId. Reparenting also reflows the target group's size/padding so the change lands like a human edit.",
      inputSchema: {
        diagramId: z.string(),
        id: z.string(),
        patch: nodePatchShape,
      },
    },
    (args) => wrap(handlers.editNode(store, args as EditNodeArgs)),
  )

  server.registerTool(
    'add_group',
    {
      description:
        'Create a new group (a visual container for nodes/notes/groups) on a diagram. Returns the created group id.',
      inputSchema: {
        diagramId: z.string(),
        label: z.string(),
        color: z.string().optional(),
        parentId: z.string().nullable().optional(),
        position: positionShape.optional(),
        size: z.object({ width: z.number(), height: z.number() }).optional(),
      },
    },
    (args) => wrap(handlers.addGroup(store, args as AddGroupArgs)),
  )

  server.registerTool(
    'edit_group',
    {
      description:
        "Update an existing group's label/color/size, and/or nest it into or out of another group via parentId. Reflows containment (padding/sizing) afterward so the change lands like a human edit.",
      inputSchema: {
        diagramId: z.string(),
        id: z.string(),
        patch: z.object({
          label: z.string().optional(),
          color: z.string().optional(),
          size: z.object({ width: z.number(), height: z.number() }).optional(),
          parentId: z
            .string()
            .nullable()
            .optional()
            .describe('Set to a group id to nest this group inside it, or null to un-parent.'),
        }),
      },
    },
    (args) => wrap(handlers.editGroup(store, args as EditGroupArgs)),
  )

  server.registerTool(
    'layout',
    {
      description: 'Re-run automatic layout on a diagram.',
      inputSchema: { diagramId: z.string() },
    },
    async (args) => wrap(await handlers.layout(store, args.diagramId)),
  )

  server.registerTool(
    'author_flow',
    {
      description:
        'Create a named walkthrough (flow) over a diagram: an ordered list of steps that light up elements cumulatively with a moving highlight. Each step lists the elements to light up (by id, or an edge as {from,to}) plus an optional caption.',
      inputSchema: {
        diagramId: z.string(),
        name: z.string(),
        steps: z.array(
          z.object({
            elements: z.array(
              z.union([z.string(), z.object({ from: z.string(), to: z.string() })]),
            ),
            caption: z.string().optional(),
          }),
        ),
      },
    },
    (args) => wrap(handlers.authorFlow(store, args as any)),
  )

  const elementRefShape = z.union([z.string(), z.object({ from: z.string(), to: z.string() })])

  server.registerTool(
    'add_flow_step',
    {
      description:
        'Insert a new step into an existing flow, lighting up the given elements (by id, or an edge as {from,to}).',
      inputSchema: {
        diagramId: z.string(),
        flowId: z.string(),
        elements: z.array(elementRefShape),
        caption: z.string().optional(),
        index: z.number().optional(),
      },
    },
    (args) => wrap(handlers.addFlowStep(store, args as any)),
  )

  server.registerTool(
    'set_flow_step',
    {
      description: "Update an existing flow step's elements and/or caption.",
      inputSchema: {
        diagramId: z.string(),
        flowId: z.string(),
        stepId: z.string(),
        patch: z.object({
          elements: z.array(elementRefShape).optional(),
          caption: z.string().optional(),
        }),
      },
    },
    (args) => wrap(handlers.setFlowStep(store, args as any)),
  )

  server.registerTool(
    'remove_flow_step',
    {
      description: 'Remove a step from a flow.',
      inputSchema: { diagramId: z.string(), flowId: z.string(), stepId: z.string() },
    },
    (args) => wrap(handlers.removeFlowStep(store, args as any)),
  )

  server.registerTool(
    'rename_flow',
    {
      description: 'Rename an existing flow.',
      inputSchema: { diagramId: z.string(), flowId: z.string(), name: z.string() },
    },
    (args) => wrap(handlers.renameFlow(store, args as any)),
  )

  server.registerTool(
    'delete_flow',
    {
      description: 'Delete a flow from a diagram.',
      inputSchema: { diagramId: z.string(), flowId: z.string() },
    },
    (args) => wrap(handlers.deleteFlow(store, args as any)),
  )

  return server
}
