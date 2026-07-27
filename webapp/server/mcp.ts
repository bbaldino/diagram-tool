import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EdgeDir } from '../src/graph'
import type { DEdge, Diagram, EdgeOrientation, Placement } from '../src/model'
import { getDiagram } from '../src/model'
import type { Op } from '../src/ops'
import { diffToOps } from '../src/diff'
import { layoutDiagram, type LayoutEngine, DEFAULT_ENGINE } from './layout'
import { authorDiagramOps, type AuthorSpec } from './authoring'
import type { Store } from './store'

// ---------------------------------------------------------------------------
// Argument shapes for the write handlers.
// ---------------------------------------------------------------------------

export interface PlaceEntityArgs {
  diagramId: string
  entityId: string
  position?: { x: number; y: number }
  parentId?: string | null
  note?: string
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
  patch: Partial<Pick<DEdge, 'label' | 'dir' | 'color' | 'orientation'>>
}

export interface SetNoteArgs {
  diagramId: string
  entityId: string
  note: string
}

export interface RemoveArgs {
  diagramId: string
  entityId?: string
  edgeId?: string
  groupId?: string
}

type ErrorResult = { error: string }
type OkResult = { ok: true }

const err = (message: string): ErrorResult => ({ error: message })

// A flow step's element reference: either an existing element id (entity
// placement / edge / group / note) or an edge specified by its endpoints.
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
    diagram.placements.some((p) => p.entityId === ref) ||
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
  listEntities(store: Store): { id: string; label: string; icon?: string; status?: string }[] {
    return store.getState().model.entities.map((e) => ({
      id: e.id,
      label: e.label,
      icon: e.icon,
      status: e.status,
    }))
  },

  listDiagrams(store: Store): { id: string; name: string; type: string }[] {
    return store.getState().model.diagrams.map((d) => ({ id: d.id, name: d.name, type: d.type }))
  },

  getDiagram(store: Store, id: string): Diagram | ErrorResult {
    const d = getDiagram(store.getState().model, id)
    return d ?? err(`unknown diagram "${id}"`)
  },

  async authorDiagram(store: Store, spec: AuthorSpec): Promise<{ diagramId: string } | ErrorResult> {
    const model = store.getState().model
    let built: { ops: Op[]; diagramId: string }
    try {
      built = await authorDiagramOps(model, spec)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
    store.apply(built.ops, 'mcp')
    return { diagramId: built.diagramId }
  },

  placeEntity(store: Store, a: PlaceEntityArgs): OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!model.entities.some((e) => e.id === a.entityId)) return err(`unknown entity "${a.entityId}"`)
    if (diagram.placements.some((p) => p.entityId === a.entityId)) {
      return err(`entity "${a.entityId}" already placed in diagram "${a.diagramId}"`)
    }
    if (typeof a.parentId === 'string' && !diagram.groups.some((grp) => grp.id === a.parentId)) {
      return err(`unknown group id "${a.parentId}"`)
    }
    const placement: Placement = {
      entityId: a.entityId,
      position: a.position ?? { x: 0, y: 0 },
    }
    if (a.parentId !== undefined) placement.parentId = a.parentId
    if (a.note !== undefined) placement.note = a.note
    store.apply([{ t: 'placement.add', diagramId: a.diagramId, placement }], 'mcp')
    return { ok: true }
  },

  connect(store: Store, a: ConnectArgs): OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.placements.some((p) => p.entityId === a.from)) {
      return err(`node "${a.from}" is not placed in diagram "${a.diagramId}"`)
    }
    if (!diagram.placements.some((p) => p.entityId === a.to)) {
      return err(`node "${a.to}" is not placed in diagram "${a.diagramId}"`)
    }
    const edge: DEdge = {
      id: `e-${a.from}-${a.to}-${Date.now().toString(36)}`,
      from: a.from,
      to: a.to,
      type: 'talks-to',
    }
    if (a.label !== undefined) edge.label = a.label
    if (a.dir !== undefined) edge.dir = a.dir
    if (a.color !== undefined) edge.color = a.color
    if (a.orientation !== undefined) edge.orientation = a.orientation
    store.apply([{ t: 'edge.add', diagramId: a.diagramId, edge }], 'mcp')
    return { ok: true }
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

  setNote(store: Store, a: SetNoteArgs): OkResult | ErrorResult {
    const model = store.getState().model
    const diagram = getDiagram(model, a.diagramId)
    if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
    if (!diagram.placements.some((p) => p.entityId === a.entityId)) {
      return err(`node "${a.entityId}" is not placed in diagram "${a.diagramId}"`)
    }
    store.apply(
      [{ t: 'placement.set', diagramId: a.diagramId, entityId: a.entityId, patch: { note: a.note } }],
      'mcp',
    )
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
      if (!diagram.groups.some((g) => g.id === a.groupId)) return err(`unknown group "${a.groupId}"`)
      ops.push({ t: 'group.remove', diagramId: a.diagramId, id: a.groupId })
    }
    if (a.entityId !== undefined) {
      if (!diagram.placements.some((p) => p.entityId === a.entityId)) {
        return err(`node "${a.entityId}" is not placed in diagram "${a.diagramId}"`)
      }
      ops.push({ t: 'placement.remove', diagramId: a.diagramId, entityId: a.entityId })
    }
    if (ops.length === 0) return err('remove: specify one of entityId, edgeId, or groupId')
    store.apply(ops, 'mcp')
    return { ok: true }
  },

  async layout(store: Store, diagramId: string, engine: LayoutEngine = DEFAULT_ENGINE): Promise<OkResult | ErrorResult> {
    const model = store.getState().model
    const diagram = getDiagram(model, diagramId)
    if (!diagram) return err(`unknown diagram "${diagramId}"`)
    const laid = await layoutDiagram(diagram, engine)
    const nextDiagram: Diagram = { ...diagram, placements: laid.placements, groups: laid.groups, edges: laid.edges }
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
// string here would let a bad value flow into DEdge.type and throw in the
// renderer (REL[type].color). Exported so it's independently testable.
export const edgeAttrsShape = {
  label: z.string().optional(),
  dir: z.enum(['forward', 'backward', 'both']).optional(),
  color: z.string().optional(),
  orientation: z.enum(['auto', 'horizontal', 'vertical']).optional(),
}

const authorSpecShape = {
  name: z.string(),
  type: z.enum(['canvas', 'topology', 'call-flow']).optional(),
  nodes: z.array(z.union([z.string(), z.object({ new: z.string(), icon: z.string().optional() })])),
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
  notes: z.record(z.string(), z.string()).optional(),
  positions: z.record(z.string(), positionShape).optional(),
}

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer({ name: 'homelab-diagram', version: '0.1.0' })

  server.registerTool(
    'list_entities',
    { description: 'List all entities (services/actors) in the catalog.', inputSchema: {} },
    () => wrap(handlers.listEntities(store)),
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
        'Create a new, automatically laid-out diagram from a high-level spec. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
      inputSchema: authorSpecShape,
    },
    async (args) => wrap(await handlers.authorDiagram(store, args as AuthorSpec)),
  )

  server.registerTool(
    'place_entity',
    {
      description: 'Place an existing entity into a diagram.',
      inputSchema: {
        diagramId: z.string(),
        entityId: z.string(),
        position: positionShape.optional(),
        parentId: z.string().nullable().optional(),
        note: z.string().optional(),
      },
    },
    (args) => wrap(handlers.placeEntity(store, args as PlaceEntityArgs)),
  )

  server.registerTool(
    'connect',
    {
      description:
        'Add an edge between two placed nodes in a diagram. Edge `orientation` controls which sides an edge connects to once laid out: `horizontal` (left/right) for directional data/request flow (I/O); `vertical` (top/bottom) for "interacts with"/peer/side-channel relationships; `auto` (default) lets the layout pick the side nearest the other node. The side is always chosen by geometry; orientation only fixes the axis.',
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
      description: "Set the inline note shown inside an entity's box in a diagram.",
      inputSchema: { diagramId: z.string(), entityId: z.string(), note: z.string() },
    },
    (args) => wrap(handlers.setNote(store, args as SetNoteArgs)),
  )

  server.registerTool(
    'remove',
    {
      description: 'Remove a placement, edge, or group from a diagram.',
      inputSchema: {
        diagramId: z.string(),
        entityId: z.string().optional(),
        edgeId: z.string().optional(),
        groupId: z.string().optional(),
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

  return server
}
