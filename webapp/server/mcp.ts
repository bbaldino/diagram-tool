import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EdgeDir } from '../src/graph'
import type { Diagram, Edge, EdgeOrientation, Node, Note, Status } from '../src/model'
import { getDiagram } from '../src/model'
import { newId } from '../src/ids'
import type { Op } from '../src/ops'
import { diffToOps } from '../src/diff'
import { layoutDiagram, type LayoutEngine, DEFAULT_ENGINE } from './layout'
import { authorDiagramOps, type AuthorSpec } from './authoring'
import type { Store } from './store'

// ---------------------------------------------------------------------------
// Argument shapes for the write handlers.
// ---------------------------------------------------------------------------

export interface AddNodeArgs {
  diagramId: string
  label: string
  icon?: string
  status?: Status
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

export interface SetEdgeArgs {
  diagramId: string
  edgeId: string
  patch: Partial<Pick<Edge, 'label' | 'dir' | 'color' | 'orientation'>>
}

export interface SetNoteArgs {
  diagramId: string
  id?: string // update an existing note when given; otherwise create one
  text: string
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  parentId?: string | null
}

export interface RemoveArgs {
  diagramId: string
  nodeId?: string
  edgeId?: string
  groupId?: string
  noteId?: string
}

type ErrorResult = { error: string }
type OkResult = { ok: true }

const err = (message: string): ErrorResult => ({ error: message })

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
  listNodes(store: Store, diagramId: string): { id: string; label: string; icon?: string; status?: string }[] | ErrorResult {
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

  async authorDiagram(store: Store, spec: AuthorSpec): Promise<{ diagramId: string; nodeIds: string[] } | ErrorResult> {
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
    const node: Node = { id: newId(), label: a.label, fields: [], position: a.position ?? { x: 0, y: 0 } }
    if (a.icon !== undefined) node.icon = a.icon
    if (a.status !== undefined) node.status = a.status
    if (a.parentId) node.parentId = a.parentId
    store.apply([{ t: 'node.add', diagramId: a.diagramId, node }], 'mcp')
    return { id: node.id }
  },

  connect(store: Store, a: ConnectArgs): { id: string } | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.nodes.some((n) => n.id === a.from)) {
      return err(`node "${a.from}" not found in diagram "${a.diagramId}"`)
    }
    if (!diagram.nodes.some((n) => n.id === a.to)) {
      return err(`node "${a.to}" not found in diagram "${a.diagramId}"`)
    }
    const edge: Edge = { id: newId(), from: a.from, to: a.to, type: 'talks-to' }
    if (a.label !== undefined) edge.label = a.label
    if (a.dir !== undefined) edge.dir = a.dir
    if (a.color !== undefined) edge.color = a.color
    if (a.orientation !== undefined) edge.orientation = a.orientation
    store.apply([{ t: 'edge.add', diagramId: a.diagramId, edge }], 'mcp')
    return { id: edge.id }
  },

  setEdge(store: Store, a: SetEdgeArgs): OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.edges.some((e) => e.id === a.edgeId)) {
      return err(`unknown edge "${a.edgeId}" in diagram "${a.diagramId}"`)
    }
    store.apply([{ t: 'edge.update', diagramId: a.diagramId, id: a.edgeId, patch: a.patch }], 'mcp')
    return { ok: true }
  },

  // Creates a new sticky note (Note entity) on the diagram, or — when `a.id`
  // is given — updates an existing one. There is no more per-node inline
  // note; notes are their own top-level element now.
  setNote(store: Store, a: SetNoteArgs): { id: string } | OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (a.id !== undefined) {
      if (!diagram.notes.some((n) => n.id === a.id)) {
        return err(`unknown note "${a.id}" in diagram "${a.diagramId}"`)
      }
      const patch: Partial<Omit<Note, 'id'>> = { text: a.text }
      if (a.position !== undefined) patch.position = a.position
      if (a.size !== undefined) patch.size = a.size
      if (a.parentId !== undefined) patch.parentId = a.parentId ?? undefined
      store.apply([{ t: 'note.update', diagramId: a.diagramId, id: a.id, patch }], 'mcp')
      return { ok: true }
    }
    const note: Note = {
      id: newId(),
      text: a.text,
      position: a.position ?? { x: 0, y: 0 },
      size: a.size ?? { width: 160, height: 90 },
    }
    if (a.parentId) note.parentId = a.parentId
    store.apply([{ t: 'note.add', diagramId: a.diagramId, note }], 'mcp')
    return { id: note.id }
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
      if (!diagram.groups.some((g) => g.id === a.groupId)) return err(`unknown group "${a.groupId}"`)
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

  async layout(store: Store, diagramId: string, engine: LayoutEngine = DEFAULT_ENGINE): Promise<OkResult | ErrorResult> {
    const model = store.getState().model
    const diagram = getDiagram(model, diagramId)
    if (!diagram) return err(`unknown diagram "${diagramId}"`)
    const laid = await layoutDiagram(diagram, engine)
    const nextDiagram: Diagram = { ...diagram, nodes: laid.nodes, groups: laid.groups, edges: laid.edges }
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
    store.apply([{ t: 'flow.add', diagramId: a.diagramId, flow: { id: flowId, name: a.name, steps } }], 'mcp')
    return { flowId }
  },

  addFlowStep(
    store: Store,
    a: { diagramId: string; flowId: string; elements: ElementRef[]; caption?: string; index?: number },
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
    store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps } }], 'mcp')
    return { ok: true }
  },

  setFlowStep(
    store: Store,
    a: { diagramId: string; flowId: string; stepId: string; patch: { elements?: ElementRef[]; caption?: string } },
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
    store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps } }], 'mcp')
    return { ok: true }
  },

  removeFlowStep(store: Store, a: { diagramId: string; flowId: string; stepId: string }): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    const flow = diagram.flows?.find((f) => f.id === a.flowId)
    if (!flow) return err(`unknown flow "${a.flowId}"`)
    if (!flow.steps.some((s) => s.id === a.stepId)) return err(`unknown step "${a.stepId}"`)
    store.apply(
      [{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps: flow.steps.filter((s) => s.id !== a.stepId) } }],
      'mcp',
    )
    return { ok: true }
  },

  renameFlow(store: Store, a: { diagramId: string; flowId: string; name: string }): OkResult | ErrorResult {
    const diagram = getDiagram(store.getState().model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.flows?.some((f) => f.id === a.flowId)) return err(`unknown flow "${a.flowId}"`)
    store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { name: a.name } }], 'mcp')
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

// spec.nodes entries mint brand-new nodes (uuid ids) — there is no catalog to
// resolve an "existing" node against. spec.edges/groups/positions refer back
// to a node minted earlier in the SAME call via a spec-local ref derived from
// its label (see authoring.ts); they are never the node's real id.
const authorSpecShape = {
  name: z.string(),
  type: z.enum(['canvas', 'topology', 'call-flow']).optional(),
  nodes: z.array(z.union([z.string(), z.object({ label: z.string(), icon: z.string().optional() })])),
  edges: z
    .array(
      z.tuple([
        z.string(),
        z.string(),
        z.object(edgeAttrsShape).optional(),
      ]),
    )
    .optional(),
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
        icon: z.string().optional(),
        status: z.enum(['up', 'down', 'idle']).optional(),
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
        'Add an edge between two nodes in a diagram. Returns the created edge id. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
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
    'set_edge',
    {
      description:
        'Update an existing edge in a diagram. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
      inputSchema: {
        diagramId: z.string(),
        edgeId: z.string(),
        patch: z.object(edgeAttrsShape),
      },
    },
    (args) => wrap(handlers.setEdge(store, args as SetEdgeArgs)),
  )

  server.registerTool(
    'set_note',
    {
      description:
        'Create a new sticky note on a diagram, or update an existing one when `id` is given. Returns the created note id when creating.',
      inputSchema: {
        diagramId: z.string(),
        id: z.string().optional(),
        text: z.string(),
        position: positionShape.optional(),
        size: z.object({ width: z.number(), height: z.number() }).optional(),
        parentId: z.string().nullable().optional(),
      },
    },
    (args) => wrap(handlers.setNote(store, args as SetNoteArgs)),
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

  server.registerTool(
    'layout',
    { description: 'Re-run automatic layout on a diagram.', inputSchema: { diagramId: z.string() } },
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
            elements: z.array(z.union([z.string(), z.object({ from: z.string(), to: z.string() })])),
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
      description: 'Insert a new step into an existing flow, lighting up the given elements (by id, or an edge as {from,to}).',
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
        patch: z.object({ elements: z.array(elementRefShape).optional(), caption: z.string().optional() }),
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
