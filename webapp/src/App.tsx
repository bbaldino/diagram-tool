import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
} from '@xyflow/react'
import { nodeTypes } from './nodes'
import { edgeTypes } from './WaypointEdge'
import {
  buildSeed,
  makeEdge,
  restyleEdge,
  applyReconnect,
  shrinkGroupToChildren,
  topoOrderByParent,
  reflowGroups,
  recomputeChildExtents,
  placeInGroup,
  liveFootprint,
  REL,
  GROUP_COLOR,
  parentGroup,
  type RelType,
  type EdgeDir,
} from './graph'
import { buildDiagramGraph } from './buildGraph'
import { Inspector } from './Inspector'
import { FlowPanel } from './FlowPanel'
import { DiagramTabs } from './DiagramTabs'
import { CanvasAddMenu } from './CanvasAddMenu'
import { CanvasPill } from './CanvasPill'
import { MenuBar } from './MenuBar'
import { OpenDiagramDialog } from './OpenDiagramDialog'
import type { MenuItem } from './menuNav'
import { useDialogs } from './Dialog'
import { sanitizeOpenTabs, addTab, closeTab } from './tabsState'
import { fetchState, subscribe, sendOps, clientId, undo as undoReq, redo as redoReq } from './modelClient'
import { diffToOps } from './diff'
import { flowStates } from './flowState'
import { newId } from './ids'
import * as M from './model'
import type {
  Model,
  Node as MNode,
  Group as MGroup,
  Note as MNote,
  Edge as MEdge,
} from './model'

const ACTIVE_KEY = 'homelab-active-diagram'
const OPEN_TABS_KEY = 'homelab-open-tabs'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
// The shape MenuBar's save-status indicator expects — a subset of SaveState
// (it has no separate "idle" rendering; idle maps onto "saved" with no text).
type BarSaveState = { label: string; kind: 'saved' | 'saving' | 'error' }

// RF needs every parent node to appear before its children in the array —
// and since groups can nest, "groups before non-groups" alone isn't enough:
// the groups themselves must be topologically ordered outer-to-inner (see
// topoOrderByParent), or a group reparented under a later-in-array group
// renders mispositioned/clipped wrong and RF warns "Parent node not found."
const groupsFirst = (ns: Node[]): Node[] => [
  ...topoOrderByParent(ns.filter((n) => n.type === 'group')),
  ...ns.filter((n) => n.type !== 'group'),
]

// Map the live React Flow nodes back into the model's per-diagram arrays.
// Nodes are diagram-local now, so every field lives directly on the Node —
// EXCEPT `fields` and `template`, which the canvas never carries (there's no
// on-canvas UI for them); those are merged back in from the diagram's
// previous nodes (keyed by id) so a geometry-only write-back can't wipe them.
function nodesToDiagramParts(
  nodes: Node[],
  prevNodesById: Map<string, MNode>,
): { nodes: MNode[]; groups: MGroup[]; notes: MNote[] } {
  const dNodes: MNode[] = []
  const groups: MGroup[] = []
  const notes: MNote[] = []
  for (const n of nodes) {
    if (n.type === 'group') {
      const d = n.data as any
      groups.push({
        id: n.id,
        label: d.label,
        color: d.color,
        position: n.position,
        parentId: n.parentId ?? undefined,
        size: {
          width: Number((n.style as any)?.width) || 320,
          height: Number((n.style as any)?.height) || 200,
        },
      })
    } else if (n.type === 'note') {
      const d = n.data as any
      notes.push({
        id: n.id,
        text: d.text ?? '',
        position: n.position,
        parentId: n.parentId ?? undefined,
        size: {
          width: Number((n.style as any)?.width) || 190,
          height: Number((n.style as any)?.height) || 110,
        },
      })
    } else if (n.type === 'service') {
      const d = n.data as any
      const prev = prevNodesById.get(n.id)
      dNodes.push({
        id: n.id,
        label: d.label,
        sub: d.sub || undefined,
        icon: d.icon || undefined,
        status: d.status || undefined,
        actor: d.kind === 'actor' ? true : undefined,
        note: (d.note as string) || undefined,
        template: prev?.template,
        fields: prev?.fields ?? [],
        position: n.position,
        parentId: n.parentId ?? undefined,
      })
    }
  }
  return { nodes: dNodes, groups, notes }
}

// `orientation` has no on-canvas UI either (server-side layout hint only) —
// preserve it from the diagram's previous edge, same reasoning as fields/template above.
function edgesToDiagramEdges(edges: Edge[], prevEdgesById: Map<string, MEdge>): MEdge[] {
  return edges.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
    type: (e.data as any)?.rel ?? 'talks-to',
    label: typeof e.label === 'string' ? e.label : undefined,
    inferred: !!(e.data as any)?.inferred,
    shape: (e.data as any)?.shape ?? 'default',
    points: (e.data as any)?.points,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    dir: (e.data as any)?.dir ?? 'forward',
    color: (e.data as any)?.color ?? undefined,
    labelPos: (e.data as any)?.labelPos,
    orientation: prevEdgesById.get(e.id)?.orientation,
  }))
}

// Flush the live canvas (nodes/edges) into the model for the given diagram:
// map node/group/note/edge geometry (and inline node fields) into the
// diagram's arrays. This is the pure form of the debounced write-back; call
// it before any model mutation so pending canvas edits aren't lost when the
// canvas is rebuilt from `model`.
function flushCanvasInto(m: Model, diagramId: string, nodes: Node[], edges: Edge[]): Model {
  const d = M.getDiagram(m, diagramId)
  const prevNodesById = new Map((d?.nodes ?? []).map((n) => [n.id, n]))
  const prevEdgesById = new Map((d?.edges ?? []).map((e) => [e.id, e]))
  const parts = nodesToDiagramParts(nodes, prevNodesById)
  return M.patchDiagram(m, diagramId, {
    nodes: parts.nodes,
    groups: parts.groups,
    notes: parts.notes,
    edges: edgesToDiagramEdges(edges, prevEdgesById),
  })
}

// All ids reachable by following parentId edges out of `id` (its children,
// grandchildren, ...) among the live canvas nodes. Used both to guard against
// reparenting cycles and to cascade-delete a group's contents.
function descendantsOf(id: string, nodes: Node[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }
  const out = new Set<string>()
  const stack = [...(children.get(id) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    stack.push(...(children.get(cur) ?? []))
  }
  return out
}

function Flow({
  model,
  setModel,
  activeId,
  setActiveId,
  openTabs,
  setOpenTabs,
  undoFlags,
  saveState,
  onRetrySave,
}: {
  model: Model
  setModel: React.Dispatch<React.SetStateAction<Model>>
  activeId: string | null
  setActiveId: (id: string | null) => void
  openTabs: string[]
  setOpenTabs: React.Dispatch<React.SetStateAction<string[]>>
  undoFlags: { canUndo: boolean; canRedo: boolean }
  saveState: BarSaveState
  onRetrySave: () => void
}) {
  const { showPrompt, showConfirm } = useDialogs()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selNode, setSelNode] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [edgeStyle, setEdgeStyle] = useState<'default' | 'smoothstep' | 'straight'>('default')
  const [layoutEngine, setLayoutEngine] = useState<'elk' | 'graphviz'>(
    () => (localStorage.getItem('homelab-layout-engine') as 'elk' | 'graphviz') || 'elk',
  )
  const chooseEngine = useCallback((e: 'elk' | 'graphviz') => {
    setLayoutEngine(e)
    localStorage.setItem('homelab-layout-engine', e)
  }, [])
  // Flow (walkthrough) UI state — client-only, never persisted in the model.
  const [flowMode, setFlowMode] = useState<'none' | 'edit' | 'play'>('none')
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [selStep, setSelStep] = useState(0)
  // "Add" menu opened by double-clicking empty canvas: {sx,sy} = screen coords
  // for popup placement, flow = flow coords for the new node.
  const [addMenu, setAddMenu] = useState<{
    sx: number
    sy: number
    flow: { x: number; y: number }
  } | null>(null)
  const rf = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0 })
  // entity id to select + center after the next re-seed (canvas create)
  const pendingSelect = useRef<string | null>(null)
  // When the write-back effect pushes canvas edits into the model, model
  // identity changes — but the canvas already reflects that state, so we must
  // NOT re-seed from it (that would clobber in-flight edits). This flag lets
  // the re-seed effect skip exactly those self-inflicted model updates.
  const skipReseed = useRef(false)
  // Set by handlers (e.g. reconnect) that need the NEXT write-back to fire
  // immediately instead of waiting out the 400ms debounce, so an undo taken
  // right after the edit doesn't race the pending flush.
  const flushImmediately = useRef(false)
  // The active diagram id at the last re-seed. Used to fitView only when the
  // diagram actually changed, so same-diagram re-seeds (place/remove/rename)
  // don't jump the viewport.
  const lastSeededId = useRef<string | null>(null)
  // Whether a MenuBar menu is currently open. Read (not subscribed to) by the
  // flow-playback arrow-key handler below so an open menu's own arrow-key
  // navigation doesn't also step the flow.
  const menuOpenRef = useRef(false)
  const handleMenuOpenChange = useCallback((open: boolean) => {
    menuOpenRef.current = open
  }, [])

  const active = useMemo(
    () => (model && activeId ? M.getDiagram(model, activeId) : undefined),
    [model, activeId],
  )
  // Tab strip contents: every open id that still resolves to a real diagram
  // (a stale id — e.g. one deleted from another client — just drops silently
  // rather than rendering a broken tab).
  const tabs = useMemo(
    () =>
      openTabs
        .map((id) => ({ id, name: (model && M.getDiagram(model, id)?.name) ?? id }))
        .filter((t) => model && M.getDiagram(model, t.id)),
    [openTabs, model],
  )
  const meta = useMemo(
    () => (active ? { entities: active.nodes.length, groups: active.groups.length, edges: active.edges.length } : null),
    [active],
  )
  const currentFlow = useMemo(
    () => active?.flows?.find((f) => f.id === currentFlowId) ?? null,
    [active, currentFlowId],
  )

  // Maps an element id to its flow-walkthrough class for the current flow/step,
  // or undefined when no flow is active (normal rendering). Shared by the
  // re-seed (so freshly built nodes/edges are classed from creation) and the
  // re-tag effect (so step-only changes re-class without a re-seed).
  const flowClassOf = useCallback(
    (id: string): string | undefined => {
      if (flowMode === 'none' || !currentFlow) return undefined
      const activeStep = flowMode === 'edit' ? selStep : currentStep
      const s = flowStates(currentFlow, activeStep)[id]
      return s === 'active' ? 'flow-active' : s === 'lit' ? 'flow-lit' : 'flow-ghost'
    },
    [flowMode, currentFlow, currentStep, selStep],
  )

  // Tag every live node/edge with a flow-walkthrough class (flow-active /
  // flow-lit / flow-ghost) when a flow is selected and mode isn't 'none';
  // clears the class (normal rendering) otherwise. Maps the existing
  // nodes/edges in place — no re-seed from the model.
  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, className: flowClassOf(n.id) })))
    setEdges((es) =>
      es.map((e) => {
        const fc = flowClassOf(e.id)
        // Also stash the state in data: the label renders in a portal outside
        // the edge <g>, so the className alone can't reach it (see WaypointEdge).
        return { ...e, className: fc, data: { ...e.data, flowState: fc } }
      }),
    )
  }, [flowClassOf, setNodes, setEdges])

  // Re-seed the live canvas from the model whenever the active diagram changes
  // or the model is loaded/replaced externally. Skips model updates that came
  // from our own write-back so live drags aren't clobbered.
  useEffect(() => {
    if (!model || !activeId) return
    if (skipReseed.current) {
      skipReseed.current = false
      return
    }
    const d = M.getDiagram(model, activeId)
    if (!d) return
    const built = buildDiagramGraph(d, model.templates)
    const changed = lastSeededId.current !== activeId
    const sel = pendingSelect.current
    pendingSelect.current = null
    setNodes((ns) => {
      // Preserve selection across same-diagram model-driven re-seeds (e.g.
      // toggling a field override) — without this, rebuilt nodes lose
      // `selected`, React Flow clears selection, and onSelectionChange
      // collapses the Inspector. On a diagram SWITCH, clear selection instead:
      // the previously-selected id may also exist in the new diagram and
      // would otherwise pop the Inspector open for a node the user never
      // picked in this diagram.
      const keepId = sel ?? (changed ? null : (ns.find((n) => n.selected)?.id ?? null))
      const base = groupsFirst(built.nodes).map((n) => ({ ...n, className: flowClassOf(n.id) }))
      return keepId ? base.map((n) => ({ ...n, selected: n.id === keepId })) : base
    })
    setEdges(
      built.edges.map((e) => {
        const fc = flowClassOf(e.id)
        return { ...e, className: fc, data: { ...e.data, flowState: fc } }
      }),
    )
    setEdgeStyle(((built.edges[0]?.data as any)?.shape as any) || 'default')
    loaded.current = true
    lastSeededId.current = activeId
    if (changed) {
      setTimeout(() => rf.fitView({ padding: 0.2 }), 60)
      setFlowMode('none')
      setCurrentFlowId(null)
      setCurrentStep(0)
    }
    // Newly placed/created entity: select it + center so it's obvious it landed.
    if (sel) {
      setSelNode(sel)
      setSelEdge(null)
      const p = built.nodes.find((n) => n.id === sel)?.position
      if (p) setTimeout(() => rf.setCenter(p.x, p.y, { zoom: rf.getViewport().zoom, duration: 300 }), 80)
    }
    // flowClassOf (and its flowMode/currentFlow/currentStep deps) is
    // excluded: a re-seed must stay keyed on [model, activeId] only, and the
    // closure already reads current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, activeId])

  // Persist the chosen active diagram across reloads.
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
  }, [activeId])

  // Write canvas edits back into the active diagram, debounced on the settle
  // of nodes/edges. This maps every edit — drag, group/note changes, edges,
  // reparenting, tidy/distribute/shrink — into the diagram's node/group/
  // note/edge arrays (see flushCanvasInto).
  useEffect(() => {
    if (!loaded.current || !activeId) return
    const diagramId = activeId
    const delay = flushImmediately.current ? 0 : 400
    flushImmediately.current = false
    const t = setTimeout(() => {
      setModel((m) => {
        skipReseed.current = true
        return flushCanvasInto(m, diagramId, nodes, edges)
      })
    }, delay)
    return () => clearTimeout(t)
  }, [nodes, edges, activeId])

  // Flush the canvas into the model immediately at gesture end (e.g. drag
  // release), so an undo taken right after doesn't race the 400ms debounced
  // write-back above.
  const flushNow = useCallback(() => {
    if (!activeId) return
    const diagramId = activeId
    setModel((m) => {
      skipReseed.current = true
      return flushCanvasInto(m, diagramId, nodes, edges)
    })
  }, [activeId, nodes, edges, setModel])

  const onSelectionChange = useCallback(
    ({ nodes: sn, edges: se }: { nodes: Node[]; edges: Edge[] }) => {
      setSelNode(sn[0]?.id ?? null)
      setSelEdge(se[0]?.id ?? null)
    },
    [],
  )

  // ---- diagram switcher handlers ----
  // Each handler first flushes the live canvas into the model, then applies its
  // mutation to that flushed base — so pending canvas edits survive the re-seed.
  const selectDiagram = useCallback(
    (id: string) => {
      if (!model || id === activeId) return
      const base = activeId ? flushCanvasInto(model, activeId, nodes, edges) : model
      setModel(base)
      setActiveId(id)
    },
    [model, activeId, nodes, edges],
  )

  const newDiagram = useCallback(
    (name: string) => {
      if (!model) return
      const base = activeId ? flushCanvasInto(model, activeId, nodes, edges) : model
      const { model: m2, id } = M.addDiagram(base, name, 'canvas')
      setModel(m2)
      setActiveId(id)
      setOpenTabs((t) => addTab(t, id))
      return id
    },
    [model, activeId, nodes, edges, setOpenTabs],
  )

  // ---- tab-strip handlers (chrome redesign phase 2) ----
  const [openDialog, setOpenDialog] = useState(false)

  // Opening a not-yet-open diagram: add it to the tab strip, then switch to it
  // (selectDiagram already flushes the outgoing canvas + sets the active id).
  const openDiagram = useCallback(
    (id: string) => {
      setOpenTabs((t) => addTab(t, id))
      selectDiagram(id)
    },
    [setOpenTabs, selectDiagram],
  )

  // Closing a tab: drop it from openTabs; if it was the active tab, hand off
  // to whatever neighbor closeTab picked (or clear activeId if none remain).
  const closeDiagramTab = useCallback(
    (id: string) => {
      const r = closeTab(openTabs, activeId, id)
      setOpenTabs(r.openTabs)
      if (r.activeId !== activeId) {
        if (r.activeId) {
          selectDiagram(r.activeId)
        } else if (activeId) {
          // No neighbor left — same flush-before-switch every other diagram
          // path does (selectDiagram/newDiagram/deleteActiveDiagram), so a
          // pending non-drag edit on the closed diagram isn't lost when the
          // debounced write-back's cleanup cancels on activeId -> null.
          setModel((m) => flushCanvasInto(m, activeId, nodes, edges))
          setActiveId(null)
        }
      }
    },
    [openTabs, activeId, selectDiagram, setOpenTabs, setActiveId, setModel, nodes, edges],
  )

  const renameDiagramById = useCallback(
    (id: string, name: string) => {
      if (!model || !activeId) return
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(M.renameDiagram(base, id, name))
    },
    [model, activeId, nodes, edges],
  )

  const deleteActiveDiagram = useCallback(
    (id: string) => {
      if (!model || !activeId) return
      const base = flushCanvasInto(model, activeId, nodes, edges)
      let m = M.deleteDiagram(base, id)
      // Never leave the app with zero diagrams — deleting the last one resets
      // to a fresh empty diagram (so "delete the only diagram" = "clear it").
      let nextId = m.diagrams[0]?.id
      if (!nextId) {
        const created = M.addDiagram(m, 'Untitled', 'canvas')
        m = created.model
        nextId = created.id
      }
      setModel(m)
      if (id === activeId) setActiveId(nextId)
    },
    [model, activeId, nodes, edges],
  )

  // ---- flow handlers ----
  const selectFlow = useCallback((id: string | null) => {
    setCurrentFlowId(id)
    setCurrentStep(0)
    setSelStep(0)
  }, [])

  const createFlow = useCallback(async () => {
    if (!model || !activeId) return
    const name = await showPrompt({ title: 'New flow', label: 'Name', defaultValue: 'Flow' })
    if (!name) return
    const id = newId()
    setModel((m) => M.addFlow(m, activeId, { id, name, steps: [] }))
    setCurrentFlowId(id)
    setFlowMode('edit')
    setSelStep(0)
    setCurrentStep(0)
  }, [model, activeId, setModel, showPrompt])

  const renameFlowById = useCallback(
    async (id: string) => {
      const f = active?.flows?.find((x) => x.id === id)
      if (!f || !activeId) return
      const name = await showPrompt({ title: 'Rename flow', label: 'Name', defaultValue: f.name })
      if (name) setModel((m) => M.updateFlow(m, activeId, id, { name }))
    },
    [active, activeId, setModel, showPrompt],
  )

  const deleteFlowById = useCallback(
    (id: string) => {
      if (!activeId) return
      setModel((m) => M.removeFlow(m, activeId, id))
      if (currentFlowId === id) {
        setCurrentFlowId(null)
        setFlowMode('none')
      }
    },
    [activeId, currentFlowId, setModel],
  )

  const toggleInStep = useCallback(
    (elementId: string) => {
      if (flowMode !== 'edit' || !currentFlow || !activeId) return
      if (!currentFlow.steps[selStep]) return
      const steps = currentFlow.steps.map((s, i) =>
        i !== selStep
          ? s
          : {
              ...s,
              elementIds: s.elementIds.includes(elementId)
                ? s.elementIds.filter((x) => x !== elementId)
                : [...s.elementIds, elementId],
            },
      )
      setModel((m) => M.updateFlow(m, activeId, currentFlow.id, { steps }))
    },
    [flowMode, currentFlow, activeId, selStep, setModel],
  )

  // Ad-hoc-first: creation always mints a fresh diagram-local node (no shared
  // catalog to browse/reuse — see CanvasAddMenu).
  const createNode = useCallback(
    (rawLabel: string, at?: { x: number; y: number }) => {
      if (!model || !activeId) return
      const label = rawLabel.trim()
      if (!label) return
      const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
      const id = newId()
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(M.addNode(base, activeId, { id, label, fields: [], position: pos }))
      pendingSelect.current = id
    },
    [model, activeId, rf, nodes, edges],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      const e = makeEdge(c.source, c.target, 'talks-to', undefined, false, undefined, {
        sourceHandle: c.sourceHandle ?? undefined,
        targetHandle: c.targetHandle ?? undefined,
      })
      e.id = newId()
      e.data = { ...e.data, shape: edgeStyle }
      setEdges((eds) => addEdge(e, eds))
    },
    [edgeStyle, setEdges],
  )

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((els) => applyReconnect(oldEdge, newConnection, els))
      // Flush this rewire into the model immediately (bypass the 400ms debounce)
      // so an undo taken right after the drop doesn't race the pending write-back.
      flushImmediately.current = true
    },
    [setEdges],
  )

  // ---- editing handlers ----
  const updateNodeData = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selNode) return
      setNodes((ns) =>
        ns.map((n) => (n.id === selNode ? { ...n, data: { ...n.data, ...patch } } : n)),
      )
    },
    [selNode, setNodes],
  )

  const reparent = useCallback(
    (parentId: string) => {
      if (!selNode) return
      // Cycle guard: a node/group can't be parented to itself or to one of
      // its own descendants (only relevant for group-in-group nesting — leaf
      // nodes/notes have no descendants, so this is always a no-op for them).
      if (parentId) {
        if (parentId === selNode) return
        if (descendantsOf(selNode, nodes).has(parentId)) return
      }
      setNodes((ns) => {
        // Non-overlapping starting position: every previously-nested child
        // landed at the same fixed (GROUP_PAD, GROUP_NEST_TOP_PAD), so
        // nesting a second thing (e.g. a note and a group) into the same
        // parent stacked them exactly on top of each other. Instead, place
        // the incoming child relative to whatever's already in the target
        // group. Final extent/parent-size are still set below by
        // reflowGroups, which also grows this (and every ancestor) group to
        // actually contain it, so a nested child can never coincide with its
        // parent's box (the group-title-overlap bug) — placeInGroup's own
        // top clearance (GROUP_NEST_TOP_PAD, not GROUP_PAD) keeps the
        // child's OWN .group__label from colliding with the parent's, which
        // sits in that same strip just above the parent.
        const child = ns.find((n) => n.id === selNode)
        const siblings = parentId
          ? ns
              .filter((n) => n.parentId === parentId && n.id !== selNode)
              .map((n) => ({ position: n.position, size: liveFootprint(n) }))
          : []
        const pos = placeInGroup(child ? liveFootprint(child) : { width: 0, height: 0 }, siblings)
        const reparented = groupsFirst(
          ns.map((n) => {
            if (n.id !== selNode) return n
            if (!parentId) {
              const { parentId: _p, extent: _e, ...rest } = n as any
              return { ...rest }
            }
            return { ...n, parentId, position: pos }
          }),
        )
        return parentId ? reflowGroups(reparented) : reparented
      })
    },
    [selNode, nodes, setNodes],
  )

  const updateEdge = useCallback(
    (patch: { type?: RelType; label?: string; inferred?: boolean; dir?: EdgeDir; color?: string }) => {
      if (!selEdge) return
      setEdges((es) =>
        es.map((e) => {
          if (e.id !== selEdge) return e
          const cur = (e.data ?? {}) as any
          const type = patch.type ?? (cur.rel as RelType) ?? 'talks-to'
          const inferred = patch.inferred ?? !!cur.inferred
          const dir = patch.dir ?? (cur.dir as EdgeDir) ?? 'forward'
          const withLabel = patch.label !== undefined ? { ...e, label: patch.label } : e
          // stash dir (and, if the patch touches it, the color override) in data
          // so restyleEdge recomputes stroke/arrowheads/label from them. 'color'
          // in patch — even undefined — means "set it" (undefined = reset to type).
          let next: Edge = { ...withLabel, data: { ...(withLabel.data ?? {}), dir } }
          if ('color' in patch) next = { ...next, data: { ...next.data, color: patch.color } }
          return restyleEdge(next, type, inferred)
        }),
      )
    },
    [selEdge, setEdges],
  )

  // Deleting a group cascades to its full descendant subtree (nested groups,
  // nodes, notes) — not just direct children — so nesting a group inside a
  // group can't leave orphaned-but-invisible leftovers.
  const deleteSelected = useCallback(() => {
    if (selNode) {
      const id = selNode
      const gone = new Set([id, ...descendantsOf(id, nodes)])
      setNodes((ns) => ns.filter((n) => !gone.has(n.id)))
      setEdges((es) => es.filter((e) => !gone.has(e.source) && !gone.has(e.target)))
      setSelNode(null)
    } else if (selEdge) {
      const id = selEdge
      setEdges((es) => es.filter((e) => e.id !== id))
      setSelEdge(null)
    }
  }, [selNode, selEdge, nodes, setNodes, setEdges])

  const addGroup = useCallback((at?: { x: number; y: number }) => {
    const id = newId()
    const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
    const newNode = {
      id,
      type: 'group',
      position: pos,
      data: { label: 'New Group', color: '#64748b' },
      style: { width: 320, height: 200 },
      zIndex: -1, // matches buildGraph: group panes sit behind edges
      selected: true,
    } as Node
    setNodes((ns) => groupsFirst([...ns.map((n) => ({ ...n, selected: false })), newNode] as Node[]))
    setSelNode(id)
    setSelEdge(null)
  }, [rf, setNodes])

  const addNote = useCallback((at?: { x: number; y: number }) => {
    const id = newId()
    setNodes((ns) =>
      ns.concat({
        id,
        type: 'note',
        position: at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 220 }),
        data: { text: '' },
        style: { width: 190, height: 110 },
        zIndex: 2,
      } as Node),
    )
  }, [rf, setNodes])

  // Double-click on empty canvas opens the Add menu at the cursor. Ignore
  // double-clicks that land on a node/edge/handle — only the pane counts.
  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
      const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const sx = Math.min(e.clientX, window.innerWidth - 240)
      const sy = Math.min(e.clientY, window.innerHeight - 260)
      setAddMenu({ sx, sy, flow })
    },
    [rf],
  )

  const exportJson = useCallback(() => {
    if (!model || !activeId) return
    // Include the current canvas by flushing it into the model before export.
    const full = flushCanvasInto(model, activeId, nodes, edges)
    const blob = new Blob([JSON.stringify(full, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'homelab-model.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [model, activeId, nodes, edges])

  const onImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (!f) return
      f.text().then((t) => {
        try {
          const parsed = JSON.parse(t)
          // normalizeModel resets old catalog-shaped (pre-migration) files to
          // an empty model instead of importing incompatible data.
          const next = M.normalizeModel(parsed)
          setModel(next)
          const nextId = next.diagrams[0]?.id
          if (nextId) setActiveId(nextId)
        } catch {
          /* ignore bad file */
        }
      })
      e.target.value = ''
    },
    [],
  )

  const doUndo = useCallback(() => {
    if (!activeId) return
    void undoReq(activeId).catch(() => {})
  }, [activeId])
  const doRedo = useCallback(() => {
    if (!activeId) return
    void redoReq(activeId).catch(() => {})
  }, [activeId])

  const tidy = useCallback(() => {
    // Run the server-side layout (elkjs/Graphviz per the selector); the
    // resulting moves stream back over SSE and re-seed the canvas. Then
    // fit the view once the new positions have landed.
    fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagramId: activeId, engine: layoutEngine }),
    })
      .catch(() => {})
      .finally(() => setTimeout(() => rf.fitView({ padding: 0.2 }), 250))
  }, [rf, activeId, layoutEngine])

  const shrinkGroup = useCallback(() => {
    if (!selNode) return
    // Shrink tight, then refresh child extents from the new (smaller) size so a
    // child can't be dragged past the shrunk edges. recomputeChildExtents, NOT
    // reflowGroups — the latter would re-grow the group and undo the tight fit.
    setNodes((ns) => recomputeChildExtents(shrinkGroupToChildren(ns, selNode)))
  }, [selNode, setNodes])

  const setGroupSize = useCallback(
    (size: { width?: number; height?: number }) => {
      if (!selNode) return
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== selNode) return n
          const g = n as any
          const curW = Number(g.measured?.width) || Number(g.width) || Number((n.style as any)?.width) || 320
          const curH = Number(g.measured?.height) || Number(g.height) || Number((n.style as any)?.height) || 200
          const width = size.width ?? curW
          const height = size.height ?? curH
          return { ...n, width, height, style: { ...n.style, width, height } }
        }),
      )
      // Resizing a group changes its children's allowed drag region — recompute
      // their extents from the new size. recomputeChildExtents (not reflowGroups)
      // so the user's chosen size stands, without re-growing/re-slacking it.
      setNodes((ns) => recomputeChildExtents(ns))
    },
    [selNode, setNodes],
  )

  // Wrap RF's node-change applier: after a NodeResizer resize ends, recompute
  // every child's drag `extent` from its (now resized) parent. The extent is
  // otherwise set only on nest/load, so without this a child stays clamped to
  // the group's pre-resize boundary (or, after a shrink, can escape past it).
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes)
      if (changes.some((c) => c.type === 'dimensions' && c.resizing === false)) {
        setNodes((ns) => recomputeChildExtents(ns))
      }
    },
    [onNodesChange, setNodes],
  )

  const applyEdgeStyle = useCallback(
    (style: 'default' | 'smoothstep' | 'straight') => {
      setEdgeStyle(style)
      setEdges((es) => es.map((e) => ({ ...e, data: { ...e.data, shape: style } })))
    },
    [setEdges],
  )

  const reset = useCallback(() => {
    const s = buildSeed()
    setNodes(s.nodes)
    setEdges(s.edges)
    // The debounced write-back persists the reset canvas into the model.
    setTimeout(() => rf.fitView({ padding: 0.2 }), 40)
  }, [rf, setNodes, setEdges])

  // ---- menu bar: File menu model + dispatch ----
  // The prompt-then-mutate flows below reproduce what the removed DiagramBar
  // buttons used to do inline (showPrompt/showConfirm around the same
  // newDiagram/renameDiagramById/deleteActiveDiagram handlers).
  const promptNewDiagram = useCallback(async () => {
    const name = (
      await showPrompt({ title: 'New diagram', label: 'Name', placeholder: 'e.g. Call flow' })
    )?.trim()
    if (name) newDiagram(name)
  }, [showPrompt, newDiagram])

  // "+" in the tab strip / "New diagram" in the empty state: same prompt-then-
  // create flow as the File menu's "New diagram" (newDiagram already opens the
  // created id as a tab).
  const newDiagramInTab = useCallback(() => {
    void promptNewDiagram()
  }, [promptNewDiagram])

  const promptRenameDiagram = useCallback(async () => {
    if (!activeId) return
    const cur = model?.diagrams.find((d) => d.id === activeId)
    const name = (
      await showPrompt({ title: 'Rename diagram', label: 'Name', defaultValue: cur?.name })
    )?.trim()
    if (name) renameDiagramById(activeId, name)
  }, [showPrompt, model, activeId, renameDiagramById])

  const confirmDeleteDiagram = useCallback(async () => {
    if (!activeId) return
    const ok = await showConfirm({
      title: 'Delete this diagram?',
      message: 'This removes the diagram and everything on it.',
      danger: true,
    })
    if (ok) deleteActiveDiagram(activeId)
  }, [showConfirm, activeId, deleteActiveDiagram])

  const fileMenuItems: MenuItem[] = useMemo(
    () => [
      { id: 'new', label: 'New diagram', shortcut: '⌘N' },
      { id: 'open', label: 'Open diagram…', shortcut: '⌘O' },
      { id: 'rename', label: 'Rename…' },
      { id: 'duplicate', label: 'Duplicate', disabled: true },
      { id: 'import', label: 'Import JSON…', separatorBefore: true },
      {
        id: 'export',
        label: 'Export',
        submenu: [
          { id: 'export-json', label: 'JSON', shortcut: '⌘⇧E' },
          { id: 'export-png-view', label: 'PNG (current view)', disabled: true },
          { id: 'export-png-all', label: 'PNG (whole diagram)', disabled: true },
          { id: 'export-svg', label: 'SVG', disabled: true },
        ],
      },
      { id: 'reset', label: 'Reset diagram…', danger: true, separatorBefore: true },
      { id: 'delete', label: 'Delete diagram…', danger: true },
    ],
    [],
  )

  // Edit/View/Arrange open with empty item lists this phase — only File is wired.
  const menus = useMemo(
    () => [
      { id: 'file' as const, title: 'File', items: fileMenuItems },
      { id: 'edit' as const, title: 'Edit', items: [] },
      { id: 'view' as const, title: 'View', items: [] },
      { id: 'arrange' as const, title: 'Arrange', items: [] },
    ],
    [fileMenuItems],
  )

  const onMenuItem = useCallback(
    (menuId: string, itemId: string) => {
      if (menuId === '_save') {
        if (itemId === 'retry') onRetrySave()
        return
      }
      if (menuId !== 'file') return
      switch (itemId) {
        case 'new':
          void promptNewDiagram()
          break
        case 'open':
          setOpenDialog(true)
          break
        case 'rename':
          void promptRenameDiagram()
          break
        case 'import':
          fileRef.current?.click()
          break
        case 'export-json':
          exportJson()
          break
        case 'reset':
          reset()
          break
        case 'delete':
          void confirmDeleteDiagram()
          break
        // 'duplicate', 'export-png-view', 'export-png-all', 'export-svg' are
        // disabled items — MenuBar never dispatches clicks on them.
        default:
          break
      }
    },
    [promptNewDiagram, promptRenameDiagram, exportJson, reset, confirmDeleteDiagram, onRetrySave],
  )

  // Minimal File-menu keyboard shortcuts: ⌘/Ctrl+N (new), ⌘/Ctrl+Shift+E
  // (export JSON), ⌘/Ctrl+O (open dialog). Ignored while a text
  // input/textarea/contentEditable is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'n' && !e.shiftKey) {
        e.preventDefault()
        void promptNewDiagram()
      } else if (key === 'e' && e.shiftKey) {
        e.preventDefault()
        exportJson()
      } else if (key === 'o') {
        e.preventDefault()
        setOpenDialog(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [promptNewDiagram, exportJson])

  const miniColor = useCallback((n: Node) => {
    if (n.type === 'group') return (n.data as any).color as string
    if (n.type === 'note') return '#fde047'
    const g = parentGroup(n.id)
    return g ? GROUP_COLOR[g] : '#4f46e5'
  }, [])

  // Zoom toward the cursor (keeps the flow point under the pointer fixed).
  const zoomAtPointer = useCallback(
    (factor: number) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (!rect) return
      const { x, y, zoom } = rf.getViewport()
      const sx = pointer.current.x - rect.left
      const sy = pointer.current.y - rect.top
      const newZoom = Math.min(2, Math.max(0.15, zoom * factor))
      const fx = (sx - x) / zoom
      const fy = (sy - y) / zoom
      rf.setViewport({ x: sx - fx * newZoom, y: sy - fy * newZoom, zoom: newZoom }, { duration: 120 })
    },
    [rf],
  )

  // Keyboard: +/- zoom to cursor, 0 fits the view. Modifier-free so it doesn't
  // collide with the browser's own Ctrl/Cmd +/- page zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomAtPointer(1.2)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomAtPointer(1 / 1.2)
      } else if (e.key === '0') {
        e.preventDefault()
        rf.fitView({ padding: 0.2, duration: 200 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomAtPointer, rf])

  // Keyboard: Ctrl/Cmd-Z undo, Ctrl/Cmd-Shift-Z or Ctrl-Y redo, Ctrl/Cmd-Shift-L
  // re-run layout. Inert while a text input/textarea/contentEditable is
  // focused so the browser's own undo still works in the Inspector/note
  // textarea. Separate from the zoom handler above, which early-returns on
  // ANY modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); doRedo() }
      else if (key === 'l' && e.shiftKey) { e.preventDefault(); tidy() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doUndo, doRedo, tidy])

  // Keyboard: arrow-key stepping through the active flow in Play mode.
  // Right/Down advance, Left/Up go back; both preventDefault so React Flow
  // doesn't nudge a selected node and the page doesn't scroll. Inert while a
  // text input/textarea/contentEditable is focused (same guard as undo above).
  useEffect(() => {
    if (flowMode !== 'play') return
    const onKey = (e: KeyboardEvent) => {
      if (menuOpenRef.current) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCurrentStep((s) => Math.min(s + 1, (currentFlow?.steps.length ?? 1) - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCurrentStep((s) => Math.max(0, s - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flowMode, currentFlow])

  // Clamp currentStep into range whenever the active flow (or mode) changes,
  // e.g. switching to a flow with fewer steps than the previous currentStep.
  useEffect(() => {
    const len = currentFlow?.steps.length ?? 0
    setCurrentStep((s) => Math.min(Math.max(0, s), Math.max(0, len - 1)))
  }, [currentFlow, flowMode])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selNode) ?? null,
    [nodes, selNode],
  )
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selEdge) ?? null,
    [edges, selEdge],
  )
  const groupList = useMemo(
    () =>
      nodes
        .filter((n) => n.type === 'group')
        .map((n) => ({ id: n.id, label: (n.data as any).label as string })),
    [nodes],
  )
  // Valid reparent targets for whatever's selected: every group, minus (when
  // a group itself is selected) itself and its own descendants — picking one
  // of those would need the cycle guard in `reparent` to reject it anyway,
  // so just don't offer it.
  const groupParentOptions = useMemo(() => {
    if (selectedNode?.type !== 'group') return groupList
    const excluded = new Set([selectedNode.id, ...descendantsOf(selectedNode.id, nodes)])
    return groupList.filter((g) => !excluded.has(g.id))
  }, [groupList, selectedNode, nodes])
  // Distinct colors already used in this diagram (edge stroke + group color), for
  // the "In this diagram" quick-pick section of the edge color picker.
  const diagramColors = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) {
      const c = ((e.data as any)?.color as string) ?? REL[((e.data as any)?.rel as RelType) ?? 'talks-to']?.color
      if (c) set.add(c.toLowerCase())
    }
    for (const n of nodes) {
      const c = n.type === 'group' ? ((n.data as any)?.color as string) : undefined
      if (c) set.add(c.toLowerCase())
    }
    return [...set]
  }, [edges, nodes])

  // The selected service node's model-side record (fields/template) — these
  // don't live on the canvas, so look them up straight from the diagram.
  const selModelNode = useMemo(
    () => (selNode ? active?.nodes.find((n) => n.id === selNode) : undefined),
    [active, selNode],
  )
  const selTemplate = selModelNode?.template
    ? model.templates.find((t) => t.id === selModelNode.template)
    : undefined
  const inspectorFields = useMemo(() => {
    if (!selModelNode) return []
    const tmplShow = new Map((selTemplate?.fields ?? []).map((tf) => [tf.key, tf.showOnNode === true]))
    return selModelNode.fields.map((f) => ({
      key: f.key,
      value: f.value,
      effective: f.showOnNode === true || (tmplShow.get(f.key) === true && f.showOnNode !== false),
      overridden: f.showOnNode !== undefined,
    }))
  }, [selModelNode, selTemplate])
  // Field show/hide is model-only (no on-canvas UI for it), so it writes
  // straight to the model instead of going through the canvas write-back.
  const onFieldShow = useCallback(
    (key: string, value: boolean | undefined) => {
      if (!activeId || !selNode) return
      setModel((m) => {
        const d = M.getDiagram(m, activeId)
        const n = d?.nodes.find((x) => x.id === selNode)
        if (!n) return m
        const fields = n.fields.map((f) => (f.key === key ? { ...f, showOnNode: value } : f))
        return M.updateNode(m, activeId, selNode, { fields })
      })
    },
    [activeId, selNode, setModel],
  )

  // Reconnect anchors are live only on the selected edge (so overlapping
  // endpoints at a shared node stay individually grabbable). Annotate a derived
  // copy; onEdgesChange still owns the base `edges` state. Return the SAME array
  // when nothing changed so React Flow doesn't churn.
  const flowEdges = useMemo(() => {
    let changed = false
    const next = edges.map((e) => {
      const want = e.id === selEdge
      if (!!e.reconnectable === want) return e
      changed = true
      return { ...e, reconnectable: want }
    })
    return changed ? next : edges
  }, [edges, selEdge])

  const groupEditing = selectedNode?.type === 'group'
  return (
    <div className="shell">
      <MenuBar
        menus={menus}
        onItem={onMenuItem}
        saveState={saveState}
        onOpenChange={handleMenuOpenChange}
      />
      <DiagramTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={selectDiagram}
        onClose={closeDiagramTab}
        onNew={newDiagramInTab}
        meta={meta}
      />
      {!activeId ? (
        <div className="canvas-empty-wrap" style={{ width: '100vw', flex: 1, minHeight: 0 }}>
          <div className="canvas-empty">
            <div className="canvas-empty__title">No diagram open</div>
            <div className="canvas-empty__body">
              Open one from File ▸ Open diagram… or create a new diagram.
            </div>
            <div className="canvas-empty__actions">
              <button type="button" onClick={() => setOpenDialog(true)}>
                Open diagram…
              </button>
              <button type="button" onClick={newDiagramInTab}>
                New diagram
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div
        ref={wrapperRef}
        className={groupEditing ? 'group-editing' : undefined}
        style={{ width: '100vw', flex: 1, minHeight: 0 }}
        onMouseMove={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY }
        }}
        onDoubleClick={onCanvasDoubleClick}
      >
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodesChange={handleNodesChange}
        onNodeDragStop={flushNow}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        edgesReconnectable={false}
        elevateEdgesOnSelect
        onSelectionChange={onSelectionChange}
        onNodeClick={(_, n) => toggleInStep(n.id)}
        onEdgeClick={(_, e) => toggleInStep(e.id)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionMode={ConnectionMode.Loose}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#e2e8f0" />
        <Controls />
        <MiniMap nodeColor={miniColor} nodeStrokeWidth={2} pannable zoomable />

        <Panel position="top-center" style={{ marginTop: 14, zIndex: 6 }}>
          <CanvasPill
            canUndo={undoFlags.canUndo}
            canRedo={undoFlags.canRedo}
            onUndo={doUndo}
            onRedo={doRedo}
            onTidy={tidy}
            engine={layoutEngine}
            engines={[{ id: 'graphviz', label: 'Graphviz' }, { id: 'elk', label: 'elkjs' }]}
            onChooseEngine={(id) => chooseEngine(id as 'elk' | 'graphviz')}
            onReRun={tidy}
          />
        </Panel>

        <Panel position="top-right" className="stack-tr">
          <div className="panel toolbar">
            <button onClick={() => addGroup()}>+ Group</button>
            <button onClick={() => addNote()}>+ Note</button>
            <label className="edgestyle">
              Flow:
              <select
                value={currentFlowId ?? ''}
                onChange={(e) => selectFlow(e.target.value || null)}
              >
                <option value="">(none)</option>
                {(active?.flows ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={createFlow}>+ Flow</button>
            <button
              onClick={() => setFlowMode(flowMode === 'edit' ? 'none' : 'edit')}
              disabled={!currentFlow}
              className={flowMode === 'edit' ? 'active' : ''}
            >
              Edit
            </button>
            <button
              onClick={() => setFlowMode(flowMode === 'play' ? 'none' : 'play')}
              disabled={!currentFlow}
              className={flowMode === 'play' ? 'active' : ''}
            >
              Play
            </button>
            <button onClick={() => currentFlowId && renameFlowById(currentFlowId)} disabled={!currentFlow}>
              Rename
            </button>
            <button onClick={() => currentFlowId && deleteFlowById(currentFlowId)} disabled={!currentFlow}>
              Delete
            </button>
            <label className="edgestyle">
              Edges:
              <select value={edgeStyle} onChange={(e) => applyEdgeStyle(e.target.value as any)}>
                <option value="default">Curved</option>
                <option value="smoothstep">Angular</option>
                <option value="straight">Straight</option>
              </select>
            </label>
          </div>
          {flowMode !== 'none' && currentFlow ? (
            <FlowPanel
              flow={currentFlow}
              mode={flowMode === 'edit' ? 'edit' : 'play'}
              selStep={flowMode === 'edit' ? selStep : currentStep}
              onSelStep={(i) => (flowMode === 'edit' ? setSelStep(i) : setCurrentStep(i))}
              onChange={(steps) => activeId && setModel((m) => M.updateFlow(m, activeId, currentFlow.id, { steps }))}
              onExit={() => setFlowMode('none')}
            />
          ) : (
            <Inspector
              node={selectedNode}
              edge={selectedEdge}
              groups={groupParentOptions}
              onNodeData={updateNodeData}
              onNodeParent={reparent}
              onEdge={updateEdge}
              onShrink={shrinkGroup}
              onGroupSize={setGroupSize}
              onDelete={deleteSelected}
              fields={inspectorFields}
              onFieldShow={onFieldShow}
              diagramColors={diagramColors}
            />
          )}
        </Panel>

        <Panel position="top-left" className="stack-tl">
          <div className="panel">
            <h4>Legend</h4>
            <div className="legend__row">
              <span
                className="legend__line"
                style={{ borderTopColor: '#94a3b8', borderTopStyle: 'dashed' }}
              />
              <span>dashed = inferred (guess)</span>
            </div>
            <h4 style={{ marginTop: 10 }}>Status</h4>
            <div className="legend__row">
              <span className="legend__dot status-up" /> up
            </div>
            <div className="legend__row">
              <span className="legend__dot status-idle" /> on-demand / idle
            </div>
          </div>
        </Panel>
      </ReactFlow>

      {addMenu && (
        <CanvasAddMenu
          x={addMenu.sx}
          y={addMenu.sy}
          onCreateEntity={(label) => createNode(label, addMenu.flow)}
          onAddGroup={() => addGroup(addMenu.flow)}
          onAddNote={() => addNote(addMenu.flow)}
          onClose={() => setAddMenu(null)}
        />
      )}
      </div>
      )}
      {openDialog && (
        <OpenDiagramDialog
          diagrams={model.diagrams.map((d) => ({ id: d.id, name: d.name, entities: d.nodes.length }))}
          openTabIds={openTabs}
          onOpen={(id) => {
            openDiagram(id)
            setOpenDialog(false)
          }}
          onNew={() => {
            setOpenDialog(false)
            newDiagramInTab()
          }}
          onImport={() => {
            setOpenDialog(false)
            fileRef.current?.click()
          }}
          onClose={() => setOpenDialog(false)}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={onImport}
      />
    </div>
  )
}

export default function App() {
  const [model, setModel] = useState<Model | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveState>('idle')
  // Bumped by the menu bar's "retry" affordance on a failed save; included as
  // an effect dependency below so retrying re-runs the save even though
  // `model` itself hasn't changed since the failure.
  const [retryNonce, setRetryNonce] = useState(0)
  const [undoMap, setUndoMap] = useState<Record<string, { canUndo: boolean; canRedo: boolean }>>({})
  // Open-tabs (chrome redesign phase 2): which diagrams show as tabs in the
  // strip, persisted across reloads. Lazily seeded from localStorage.
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) || '[]')
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })
  // Becomes true once the initial model load has completed, so the autosave
  // effect below doesn't fire before there's anything to save.
  const loaded = useRef(false)
  // Reconciliation refs shared with the write path (Task 10):
  // - lastServerModel/lastServerRev: the latest snapshot the server has pushed
  //   to us (seed + SSE), used as the base for diffing local edits into ops.
  // - ownRev: the highest rev we're responsible for; SSE frames at or below it
  //   are echoes of our own writes and are ignored so we don't clobber
  //   in-flight local edits.
  const lastServerRev = useRef(0)
  const lastServerModel = useRef<Model | null>(null)
  const ownRev = useRef(0)

  // Seed the shared model once on mount from the server; pick the active
  // diagram from localStorage (validated against the model) or fall back to
  // the first.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const snap = await fetchState()
      if (cancelled) return
      const stored = localStorage.getItem(ACTIVE_KEY)
      const id =
        snap.model.diagrams.find((d) => d.id === stored)?.id ??
        snap.model.diagrams[0]?.id ??
        null
      lastServerModel.current = snap.model
      lastServerRev.current = snap.rev
      ownRev.current = snap.rev
      setModel(snap.model)
      setActiveId(id)
      setUndoMap(snap.undo ?? {})
      loaded.current = true
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Reconcile the open-tabs list against the loaded model: drop tabs for
  // diagrams that no longer exist, dedupe, and make sure the active diagram
  // always has a tab. Compared by JSON.stringify so a no-op reconcile doesn't
  // set state (openTabs is itself an effect dependency of the persist effect
  // below — churn here would loop).
  useEffect(() => {
    if (!model) return
    setOpenTabs((t) => {
      const sanitized = sanitizeOpenTabs(
        t,
        model.diagrams.map((d) => d.id),
        activeId,
      )
      return JSON.stringify(sanitized) === JSON.stringify(t) ? t : sanitized
    })
  }, [model, activeId])

  // Persist the open-tabs list across reloads.
  useEffect(() => {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabs))
  }, [openTabs])

  // Live-reconcile with the server: track the latest pushed snapshot, and apply
  // genuinely-newer external state while ignoring the echo of our own writes.
  useEffect(
    () =>
      subscribe((s) => {
        const prevServerRev = lastServerRev.current
        lastServerRev.current = s.rev
        lastServerModel.current = s.model
        setUndoMap(s.undo ?? {})
        if (s.writerId === clientId) {
          // Our own echo — refs already rebased; never clobber local edits.
          ownRev.current = s.rev
          return
        }
        // Server restart: its rev counter reset, so this frame's rev is LOWER
        // than the last we saw. Adopt it and resync ownRev — otherwise our
        // stale-high ownRev makes us ignore every post-restart broadcast
        // (frozen tab until manual reload).
        if (s.rev < prevServerRev) {
          ownRev.current = s.rev
          setModel(s.model)
          return
        }
        if (s.rev > ownRev.current) setModel(s.model)
      }),
    [],
  )

  // Sync edits to the server as ops (debounced) once the initial load is done.
  // Diff the current optimistic model against the last server snapshot; canvas
  // write-back has already flushed geometry into `model`, so it's complete.
  useEffect(() => {
    if (!loaded.current || !model) return
    if (!lastServerModel.current) return
    const t = setTimeout(() => {
      const next = model
      const base = lastServerModel.current
      if (!base) return
      const ops = diffToOps(base, next)
      if (!ops.length) return
      setSaveStatus('saving')
      sendOps(ops)
        .then((res) => {
          const rev = 'rev' in res ? res.rev : undefined
          // rev 0 is a valid server revision (fresh server, or a no-op the
          // server recognized and didn't bump); only a 400 returns no numeric
          // rev. `>= 0` — a `> 0` check falsely flags rev-0 responses as errors.
          if (typeof rev === 'number' && rev >= 0) {
            ownRev.current = rev
            lastServerModel.current = next
            setSaveStatus('saved')
          } else {
            setSaveStatus('error')
          }
        })
        .catch(() => setSaveStatus('error'))
    }, 500)
    return () => clearTimeout(t)
  }, [model, retryNonce])

  // Re-run the save effect above on demand (menu bar's retry affordance on a
  // failed save). Bumping the nonce re-triggers the effect even when `model`
  // is unchanged, which recomputes and resends the same pending ops.
  const retrySave = useCallback(() => setRetryNonce((n) => n + 1), [])

  const handleSetActive = useCallback((id: string | null) => setActiveId(id), [])
  // App owns the model, so setModel here is typed against a non-null Model;
  // Flow receives it once model has loaded (never null below).
  const setModelNonNull = setModel as React.Dispatch<React.SetStateAction<Model>>

  // Map the raw save status onto the menu bar's save-status shape. `idle`
  // (before the first diff) has no dedicated bar rendering — it shows the
  // "saved" icon with no text, matching the old tabbar's blank initial label.
  const saveState: BarSaveState =
    saveStatus === 'saving'
      ? { label: 'saving…', kind: 'saving' }
      : saveStatus === 'error'
        ? { label: "couldn't save — retry", kind: 'error' }
        : { label: saveStatus === 'saved' ? 'saved to model.json' : '', kind: 'saved' }

  return !model ? null : (
    <ReactFlowProvider>
      <Flow
        model={model}
        setModel={setModelNonNull}
        activeId={activeId}
        setActiveId={handleSetActive}
        openTabs={openTabs}
        setOpenTabs={setOpenTabs}
        undoFlags={undoMap[activeId ?? ''] ?? { canUndo: false, canRedo: false }}
        saveState={saveState}
        onRetrySave={retrySave}
      />
    </ReactFlowProvider>
  )
}
