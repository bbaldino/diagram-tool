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
} from '@xyflow/react'
import { nodeTypes } from './nodes'
import { edgeTypes } from './WaypointEdge'
import {
  buildSeed,
  makeEdge,
  restyleEdge,
  distributeGroupChildren,
  shrinkGroupToChildren,
  REL,
  GROUP_COLOR,
  parentGroup,
  type RelType,
  type EdgeDir,
} from './graph'
import { buildDiagramGraph } from './buildGraph'
import { Inspector } from './Inspector'
import { DiagramBar } from './DiagramBar'
import { Palette } from './Palette'
import { EntitiesPage } from './EntitiesPage'
import { CanvasAddMenu } from './CanvasAddMenu'
import { useDialogs } from './Dialog'
import { fetchState, subscribe, sendOps, clientId, undo as undoReq, redo as redoReq } from './modelClient'
import { diffToOps } from './diff'
import {
  entitiesById,
  getDiagram,
  patchDiagram,
  updateEntity,
  addEntity,
  addPlacement,
  removePlacement,
  deleteEntity,
  addDiagram,
  renameDiagram,
  deleteDiagram,
  fieldVisible,
  setFieldShow,
  type Model,
  type DEdge,
  type Entity,
} from './model'

const ACTIVE_KEY = 'homelab-active-diagram'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// RF needs every parent node to appear before its children in the array.
const groupsFirst = (ns: Node[]): Node[] => [
  ...ns.filter((n) => n.type === 'group'),
  ...ns.filter((n) => n.type !== 'group'),
]

// Map the live React Flow nodes back into the model's per-diagram arrays.
// Entity fields (label/sub/icon/status) are intentionally NOT written here —
// those live on the shared entity catalog and are handled via updateEntity.
function nodesToDiagramParts(nodes: Node[]) {
  const groups = nodes
    .filter((n) => n.type === 'group')
    .map((n) => ({
      id: n.id,
      label: (n.data as any).label,
      color: (n.data as any).color,
      position: n.position,
      size: {
        width: Number((n.style as any)?.width) || 320,
        height: Number((n.style as any)?.height) || 200,
      },
    }))
  const placements = nodes
    .filter((n) => n.type === 'service')
    .map((n) => ({
      entityId: n.id,
      position: n.position,
      parentId: n.parentId ?? undefined,
      note: ((n.data as any).note as string) || undefined,
    }))
  const notes = nodes
    .filter((n) => n.type === 'note')
    .map((n) => ({
      id: n.id,
      position: n.position,
      size: {
        width: Number((n.style as any)?.width) || 190,
        height: Number((n.style as any)?.height) || 110,
      },
      text: (n.data as any).text ?? '',
    }))
  return { groups, placements, notes }
}

function edgesToDEdges(edges: Edge[]): DEdge[] {
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
  }))
}

// Flush the live canvas (nodes/edges) into the model for the given diagram:
// map node/edge geometry into the diagram's arrays, and push every service
// node's entity fields onto the shared entity catalog. This is the pure form
// of the debounced write-back; call it before any model mutation so pending
// canvas edits aren't lost when the canvas is rebuilt from `model`.
function flushCanvasInto(m: Model, diagramId: string, nodes: Node[], edges: Edge[]): Model {
  // The canvas carries only geometry, so nodesToDiagramParts can't know about
  // per-diagram field overrides. Re-attach each existing placement's fieldShow
  // by entityId so the write-back doesn't wipe them.
  const prevFieldShow = new Map(
    (getDiagram(m, diagramId)?.placements ?? []).map((p) => [p.entityId, p.fieldShow]),
  )
  const parts = nodesToDiagramParts(nodes)
  const placements = parts.placements.map((p) => {
    const fs = prevFieldShow.get(p.entityId)
    return fs ? { ...p, fieldShow: fs } : p
  })
  let next = patchDiagram(m, diagramId, {
    groups: parts.groups,
    notes: parts.notes,
    placements,
    edges: edgesToDEdges(edges),
  })
  const known = new Set(m.entities.map((e) => e.id))
  for (const n of nodes) {
    if (n.type !== 'service') continue
    const data = n.data as any
    const patch = {
      label: data.label,
      sub: data.sub,
      icon: data.icon,
      status: data.status,
      kind: data.kind,
    }
    next = known.has(n.id) ? updateEntity(next, n.id, patch) : addEntity(next, { id: n.id, ...patch, fields: [] })
  }
  return next
}

function Flow({
  model,
  setModel,
  activeId,
  setActiveId,
  undoFlags,
}: {
  model: Model
  setModel: React.Dispatch<React.SetStateAction<Model>>
  activeId: string
  setActiveId: (id: string) => void
  undoFlags: { canUndo: boolean; canRedo: boolean }
}) {
  const { showConfirm } = useDialogs()
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
  // entity id to select + center after the next re-seed (palette place/create)
  const pendingSelect = useRef<string | null>(null)
  // When the write-back effect pushes canvas edits into the model, model
  // identity changes — but the canvas already reflects that state, so we must
  // NOT re-seed from it (that would clobber in-flight edits). This flag lets
  // the re-seed effect skip exactly those self-inflicted model updates.
  const skipReseed = useRef(false)
  // The active diagram id at the last re-seed. Used to fitView only when the
  // diagram actually changed, so same-diagram re-seeds (place/remove/rename)
  // don't jump the viewport.
  const lastSeededId = useRef<string | null>(null)

  const byId = useMemo(() => (model ? entitiesById(model) : {}), [model])
  const active = useMemo(
    () => (model && activeId ? getDiagram(model, activeId) : undefined),
    [model, activeId],
  )
  const placedIds = useMemo(
    () => new Set(active?.placements.map((p) => p.entityId) ?? []),
    [active],
  )

  // Re-seed the live canvas from the model whenever the active diagram changes
  // or the model is loaded/replaced externally. Skips model updates that came
  // from our own write-back so live drags aren't clobbered.
  useEffect(() => {
    if (!model || !activeId) return
    if (skipReseed.current) {
      skipReseed.current = false
      return
    }
    const d = getDiagram(model, activeId)
    if (!d) return
    const built = buildDiagramGraph(d, byId, model.templates)
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
      const base = groupsFirst(built.nodes)
      return keepId ? base.map((n) => ({ ...n, selected: n.id === keepId })) : base
    })
    setEdges(built.edges)
    setEdgeStyle(((built.edges[0]?.data as any)?.shape as any) || 'default')
    loaded.current = true
    lastSeededId.current = activeId
    if (changed) setTimeout(() => rf.fitView({ padding: 0.2 }), 60)
    // Newly placed/created entity: select it + center so it's obvious it landed.
    if (sel) {
      setSelNode(sel)
      setSelEdge(null)
      const p = built.nodes.find((n) => n.id === sel)?.position
      if (p) setTimeout(() => rf.setCenter(p.x, p.y, { zoom: rf.getViewport().zoom, duration: 300 }), 80)
    }
    // byId is derived from model; excluded to avoid a redundant re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, activeId])

  // Persist the chosen active diagram across reloads.
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
  }, [activeId])

  // Write canvas edits back into the active diagram (and shared entities),
  // debounced on the settle of nodes/edges. This maps every edit — drag,
  // group/note changes, edges, reparenting, tidy/distribute/shrink — to the
  // right level of the model. Entity fields go through updateEntity/addEntity.
  useEffect(() => {
    if (!loaded.current || !activeId) return
    const t = setTimeout(() => {
      setModel((m) => {
        skipReseed.current = true
        return flushCanvasInto(m, activeId, nodes, edges)
      })
    }, 400)
    return () => clearTimeout(t)
  }, [nodes, edges, activeId])

  // Flush the canvas into the model immediately at gesture end (e.g. drag
  // release), so an undo taken right after doesn't race the 400ms debounced
  // write-back above.
  const flushNow = useCallback(() => {
    setModel((m) => {
      skipReseed.current = true
      return flushCanvasInto(m, activeId, nodes, edges)
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
      if (!model || !activeId || id === activeId) return
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(base)
      setActiveId(id)
    },
    [model, activeId, nodes, edges],
  )

  const newDiagram = useCallback(
    (name: string) => {
      if (!model || !activeId) return
      const base = flushCanvasInto(model, activeId, nodes, edges)
      const { model: m2, id } = addDiagram(base, name, 'canvas')
      setModel(m2)
      setActiveId(id)
    },
    [model, activeId, nodes, edges],
  )

  const renameDiagramById = useCallback(
    (id: string, name: string) => {
      if (!model || !activeId) return
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(renameDiagram(base, id, name))
    },
    [model, activeId, nodes, edges],
  )

  const deleteActiveDiagram = useCallback(
    (id: string) => {
      if (!model || !activeId) return
      const base = flushCanvasInto(model, activeId, nodes, edges)
      const m = deleteDiagram(base, id)
      setModel(m)
      if (id === activeId) {
        const nextId = m.diagrams[0]?.id
        setActiveId(nextId ?? null)
      }
    },
    [model, activeId, nodes, edges],
  )

  // ---- palette handlers ----
  const placeEntity = useCallback(
    (entityId: string, at?: { x: number; y: number }) => {
      if (!model || !activeId) return
      const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(addPlacement(base, activeId, { entityId, position: pos, parentId: null }))
      pendingSelect.current = entityId
    },
    [model, activeId, rf, nodes, edges],
  )

  const createEntity = useCallback(
    (entity: Entity) => {
      if (!model || !activeId) return
      const pos = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
      const base = flushCanvasInto(model, activeId, nodes, edges)
      setModel(
        addPlacement(addEntity(base, entity), activeId, {
          entityId: entity.id,
          position: pos,
          parentId: null,
        }),
      )
      pendingSelect.current = entity.id
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
      e.data = { ...e.data, shape: edgeStyle }
      setEdges((eds) => addEdge(e, eds))
    },
    [edgeStyle, setEdges],
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
      setNodes((ns) =>
        groupsFirst(
          ns.map((n) => {
            if (n.id !== selNode) return n
            if (!parentId) {
              const { parentId: _p, extent: _e, ...rest } = n as any
              return { ...rest }
            }
            return { ...n, parentId, extent: 'parent' as const, position: { x: 24, y: 52 } }
          }),
        ),
      )
    },
    [selNode, setNodes],
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

  const deleteSelected = useCallback(() => {
    if (selNode) {
      const id = selNode
      setNodes((ns) => ns.filter((n) => n.id !== id && n.parentId !== id))
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
      setSelNode(null)
    } else if (selEdge) {
      const id = selEdge
      setEdges((es) => es.filter((e) => e.id !== id))
      setSelEdge(null)
    }
  }, [selNode, selEdge, setNodes, setEdges])

  const removeFromDiagram = useCallback(() => {
    if (!model || !activeId || !selNode) return
    const base = flushCanvasInto(model, activeId, nodes, edges)
    setModel(removePlacement(base, activeId, selNode))
    setSelNode(null)
  }, [model, activeId, selNode, nodes, edges])

  const removeEntityEverywhere = useCallback(async () => {
    if (!model || !activeId || !selNode) return
    const ok = await showConfirm({
      title: 'Delete entity from all diagrams?',
      message: 'The entity is removed from the catalog and every diagram that places it.',
      danger: true,
    })
    if (!ok) return
    const base = flushCanvasInto(model, activeId, nodes, edges)
    setModel(deleteEntity(base, selNode))
    setSelNode(null)
  }, [model, activeId, selNode, nodes, edges, showConfirm])

  const addGroup = useCallback((at?: { x: number; y: number }) => {
    const id = `grp-${Date.now()}`
    const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
    const newNode = {
      id,
      type: 'group',
      position: pos,
      data: { label: 'New Group', color: '#64748b' },
      style: { width: 320, height: 200 },
      selected: true,
    } as Node
    setNodes((ns) => groupsFirst([...ns.map((n) => ({ ...n, selected: false })), newNode] as Node[]))
    setSelNode(id)
    setSelEdge(null)
  }, [rf, setNodes])

  const addNote = useCallback((at?: { x: number; y: number }) => {
    const id = `note-${Date.now()}`
    setNodes((ns) =>
      ns.concat({
        id,
        type: 'note',
        position: at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 220 }),
        data: { text: '' },
        style: { width: 190, height: 110 },
        zIndex: 5,
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
          if (Array.isArray(parsed?.entities) && Array.isArray(parsed?.diagrams)) {
            setModel(parsed as Model)
            const nextId = parsed.diagrams[0]?.id
            if (nextId) setActiveId(nextId)
          }
        } catch {
          /* ignore bad file */
        }
      })
      e.target.value = ''
    },
    [],
  )

  const doUndo = useCallback(() => {
    void undoReq(activeId).catch(() => {})
  }, [activeId])
  const doRedo = useCallback(() => {
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

  const distributeGroup = useCallback(() => {
    if (!selNode) return
    setNodes((ns) => distributeGroupChildren(ns, selNode))
  }, [selNode, setNodes])

  const shrinkGroup = useCallback(() => {
    if (!selNode) return
    setNodes((ns) => shrinkGroupToChildren(ns, selNode))
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
    },
    [selNode, setNodes],
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

  // Keyboard: Ctrl/Cmd-Z undo, Ctrl/Cmd-Shift-Z or Ctrl-Y redo. Inert while a
  // text input/textarea/contentEditable is focused so the browser's own undo
  // still works in the Inspector/note textarea. Separate from the zoom
  // handler above, which early-returns on ANY modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); doRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doUndo, doRedo])

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

  const selEntity = selNode ? byId[selNode] : undefined
  const selPlacement = active?.placements.find((p) => p.entityId === selNode)
  const selTemplate = selEntity?.template
    ? model.templates.find((t) => t.id === selEntity.template)
    : undefined
  const inspectorFields = useMemo(
    () =>
      selEntity
        ? selEntity.fields.map((f) => ({
            key: f.key,
            value: f.value,
            effective: fieldVisible(selPlacement, selEntity, selTemplate, f.key),
            overridden: selPlacement?.fieldShow?.[f.key] !== undefined,
          }))
        : [],
    [selEntity, selPlacement, selTemplate],
  )
  const onFieldShow = useCallback(
    (key: string, value: boolean | undefined) => {
      if (activeId && selNode) setModel((m) => setFieldShow(m, activeId, selNode, key, value))
    },
    [activeId, selNode, setModel],
  )

  const groupEditing = selectedNode?.type === 'group'
  return (
    <div
      ref={wrapperRef}
      className={groupEditing ? 'group-editing' : undefined}
      style={{ width: '100vw', height: 'calc(100vh - 40px)' }}
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY }
      }}
      onDoubleClick={onCanvasDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={flushNow}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
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

        <Panel position="top-right" className="stack-tr">
          <div className="panel toolbar">
            <button onClick={() => addGroup()}>+ Group</button>
            <button onClick={() => addNote()}>+ Note</button>
            <button onClick={doUndo} disabled={!undoFlags.canUndo} title="Undo (Ctrl/Cmd-Z)">↶ Undo</button>
            <button onClick={doRedo} disabled={!undoFlags.canRedo} title="Redo (Ctrl/Cmd-Shift-Z)">↷ Redo</button>
            <button onClick={tidy}>Tidy</button>
            <label className="edgestyle">
              Layout:
              <select value={layoutEngine} onChange={(e) => chooseEngine(e.target.value as 'elk' | 'graphviz')}>
                <option value="elk">elkjs</option>
                <option value="graphviz">Graphviz</option>
              </select>
            </label>
            <label className="edgestyle">
              Edges:
              <select value={edgeStyle} onChange={(e) => applyEdgeStyle(e.target.value as any)}>
                <option value="default">Curved</option>
                <option value="smoothstep">Angular</option>
                <option value="straight">Straight</option>
              </select>
            </label>
            <button onClick={exportJson}>Export</button>
            <button onClick={() => fileRef.current?.click()}>Import</button>
            <button onClick={reset}>Reset</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={onImport}
            />
          </div>
          <Inspector
            node={selectedNode}
            edge={selectedEdge}
            groups={groupList}
            onNodeData={updateNodeData}
            onNodeParent={reparent}
            onEdge={updateEdge}
            onDistribute={distributeGroup}
            onShrink={shrinkGroup}
            onGroupSize={setGroupSize}
            onDelete={deleteSelected}
            onRemoveFromDiagram={removeFromDiagram}
            onDeleteEntity={removeEntityEverywhere}
            fields={inspectorFields}
            onFieldShow={onFieldShow}
            diagramColors={diagramColors}
          />
        </Panel>

        <Panel position="top-left" className="stack-tl">
          {model && activeId && (
            <DiagramBar
              diagrams={model.diagrams}
              activeId={activeId}
              onSelect={selectDiagram}
              onNew={newDiagram}
              onRename={renameDiagramById}
              onDelete={deleteActiveDiagram}
            />
          )}

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

        <Panel position="bottom-left">
          {model && (
            <Palette
              entities={model.entities}
              placedIds={placedIds}
              onPlace={placeEntity}
              onCreate={createEntity}
            />
          )}
        </Panel>
      </ReactFlow>

      {addMenu && (
        <CanvasAddMenu
          x={addMenu.sx}
          y={addMenu.sy}
          entities={model.entities
            .filter((e) => !placedIds.has(e.id))
            .sort((a, b) => a.label.localeCompare(b.label))}
          onPlaceEntity={(id) => placeEntity(id, addMenu.flow)}
          onAddGroup={() => addGroup(addMenu.flow)}
          onAddNote={() => addNote(addMenu.flow)}
          onClose={() => setAddMenu(null)}
        />
      )}
    </div>
  )
}

export default function App() {
  const [model, setModel] = useState<Model | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [view, setView] = useState<'diagrams' | 'entities'>('entities')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [undoMap, setUndoMap] = useState<Record<string, { canUndo: boolean; canRedo: boolean }>>({})
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
      setSaveState('saving')
      sendOps(ops)
        .then((res) => {
          const rev = 'rev' in res ? res.rev : undefined
          // rev 0 is a valid server revision (fresh server, or a no-op the
          // server recognized and didn't bump); only a 400 returns no numeric
          // rev. `>= 0` — a `> 0` check falsely flags rev-0 responses as errors.
          if (typeof rev === 'number' && rev >= 0) {
            ownRev.current = rev
            lastServerModel.current = next
            setSaveState('saved')
          } else {
            setSaveState('error')
          }
        })
        .catch(() => setSaveState('error'))
    }, 500)
    return () => clearTimeout(t)
  }, [model])

  const handleSetActive = useCallback((id: string) => setActiveId(id), [])
  // App owns the model, so setModel here is typed against a non-null Model;
  // Flow/EntitiesPage receive it once model has loaded (never null below).
  const setModelNonNull = setModel as React.Dispatch<React.SetStateAction<Model>>

  const saveLabel =
    saveState === 'saving'
      ? '● saving…'
      : saveState === 'saved'
        ? '✓ saved to model.json'
        : saveState === 'error'
          ? '⚠ not saved (no server)'
          : ''
  const saveColor =
    saveState === 'error' ? '#dc2626' : saveState === 'saving' ? '#d97706' : '#16a34a'

  return (
    <>
      <div className="tabbar">
        <button
          className={view === 'entities' ? 'active' : ''}
          onClick={() => setView('entities')}
        >
          Entities
        </button>
        <button
          className={view === 'diagrams' ? 'active' : ''}
          onClick={() => setView('diagrams')}
        >
          Diagrams
        </button>
        <span className="tabbar__save" style={{ color: saveColor }}>
          {saveLabel}
        </span>
      </div>
      {!model ? null : view === 'diagrams' ? (
        <ReactFlowProvider>
          <Flow
            model={model}
            setModel={setModelNonNull}
            activeId={activeId!}
            setActiveId={handleSetActive}
            undoFlags={undoMap[activeId!] ?? { canUndo: false, canRedo: false }}
          />
        </ReactFlowProvider>
      ) : (
        <EntitiesPage
          model={model}
          setModel={setModelNonNull}
          onJump={(id) => {
            setActiveId(id)
            localStorage.setItem(ACTIVE_KEY, id)
            setView('diagrams')
          }}
        />
      )}
    </>
  )
}
