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
  relayout,
  distributeGroupChildren,
  shrinkGroupToChildren,
  REL,
  GROUP_COLOR,
  parentGroup,
  type RelType,
} from './graph'
import { Inspector } from './Inspector'
import { DiagramBar } from './DiagramBar'
import { Palette } from './Palette'
import {
  loadModel,
  saveModel,
  buildDiagramGraph,
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
    .map((n) => ({ entityId: n.id, position: n.position, parentId: n.parentId ?? null }))
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
  }))
}

// Flush the live canvas (nodes/edges) into the model for the given diagram:
// map node/edge geometry into the diagram's arrays, and push every service
// node's entity fields onto the shared entity catalog. This is the pure form
// of the debounced write-back; call it before any model mutation so pending
// canvas edits aren't lost when the canvas is rebuilt from `model`.
function flushCanvasInto(m: Model, diagramId: string, nodes: Node[], edges: Edge[]): Model {
  let next = patchDiagram(m, diagramId, {
    ...nodesToDiagramParts(nodes),
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
    next = known.has(n.id) ? updateEntity(next, n.id, patch) : addEntity(next, { id: n.id, ...patch })
  }
  return next
}

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [model, setModel] = useState<Model | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [selNode, setSelNode] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [edgeStyle, setEdgeStyle] = useState<'default' | 'smoothstep' | 'straight'>('default')
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

  // Load the shared model once on mount; pick the active diagram from
  // localStorage (validated against the model) or fall back to the first.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const m = await loadModel()
      if (cancelled) return
      const stored = localStorage.getItem(ACTIVE_KEY)
      const id = m.diagrams.find((d) => d.id === stored)?.id ?? m.diagrams[0]?.id ?? null
      setModel(m)
      setActiveId(id)
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
    const built = buildDiagramGraph(d, byId)
    const sel = pendingSelect.current
    pendingSelect.current = null
    setNodes(
      sel
        ? groupsFirst(built.nodes).map((n) => ({ ...n, selected: n.id === sel }))
        : groupsFirst(built.nodes),
    )
    setEdges(built.edges)
    setEdgeStyle(((built.edges[0]?.data as any)?.shape as any) || 'default')
    loaded.current = true
    setSaveState('saved')
    const changed = lastSeededId.current !== activeId
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
        if (!m) return m
        skipReseed.current = true
        return flushCanvasInto(m, activeId, nodes, edges)
      })
    }, 400)
    return () => clearTimeout(t)
  }, [nodes, edges, activeId])

  // Autosave the whole model (debounced) once the initial load is done.
  useEffect(() => {
    if (!loaded.current || !model) return
    setSaveState('saving')
    const t = setTimeout(() => {
      saveModel(model).then((ok) => setSaveState(ok ? 'saved' : 'error'))
    }, 500)
    return () => clearTimeout(t)
  }, [model])

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
        const rest = m.diagrams
        setActiveId(rest[0]?.id ?? null)
      }
    },
    [model, activeId, nodes, edges],
  )

  // ---- palette handlers ----
  const placeEntity = useCallback(
    (entityId: string) => {
      if (!model || !activeId) return
      const pos = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
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
      const e = makeEdge(c.source, c.target, 'talks-to')
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
    (patch: { type?: RelType; label?: string; inferred?: boolean }) => {
      if (!selEdge) return
      setEdges((es) =>
        es.map((e) => {
          if (e.id !== selEdge) return e
          const cur = (e.data ?? {}) as any
          const type = patch.type ?? (cur.rel as RelType) ?? 'talks-to'
          const inferred = patch.inferred ?? !!cur.inferred
          const withLabel = patch.label !== undefined ? { ...e, label: patch.label } : e
          return restyleEdge(withLabel, type, inferred)
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

  const removeEntityEverywhere = useCallback(() => {
    if (!model || !activeId || !selNode) return
    if (!confirm('Delete this entity from ALL diagrams?')) return
    const base = flushCanvasInto(model, activeId, nodes, edges)
    setModel(deleteEntity(base, selNode))
    setSelNode(null)
  }, [model, activeId, selNode, nodes, edges])

  const addGroup = useCallback(() => {
    const id = `grp-${Date.now()}`
    const pos = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 })
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

  const addNote = useCallback(() => {
    const id = `note-${Date.now()}`
    setNodes((ns) =>
      ns.concat({
        id,
        type: 'note',
        position: rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 220 }),
        data: { text: '' },
        style: { width: 190, height: 110 },
        zIndex: 5,
      } as Node),
    )
  }, [rf, setNodes])

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
            setActiveId(parsed.diagrams[0]?.id ?? null)
          }
        } catch {
          /* ignore bad file */
        }
      })
      e.target.value = ''
    },
    [],
  )

  const tidy = useCallback(() => {
    setNodes((ns) => relayout(ns))
    setTimeout(() => rf.fitView({ padding: 0.2 }), 40)
  }, [rf, setNodes])

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

  const groupEditing = selectedNode?.type === 'group'
  return (
    <div
      ref={wrapperRef}
      className={groupEditing ? 'group-editing' : undefined}
      style={{ width: '100vw', height: '100vh' }}
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        deleteKeyCode={['Backspace', 'Delete']}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#e2e8f0" />
        <Controls />
        <MiniMap nodeColor={miniColor} nodeStrokeWidth={2} pannable zoomable />

        <Panel position="top-right" className="stack-tr">
          <div className="panel toolbar">
            <button onClick={addGroup}>+ Group</button>
            <button onClick={addNote}>+ Note</button>
            <button onClick={tidy}>Tidy</button>
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
            <span style={{ marginLeft: 8, fontSize: 11, color: saveColor }}>{saveLabel}</span>
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
            <h4>Relationships</h4>
            {Object.entries(REL).map(([k, v]) => (
              <div className="legend__row" key={k}>
                <span className="legend__line" style={{ borderTopColor: v.color }} />
                <span>{v.label}</span>
              </div>
            ))}
            <div className="legend__row" style={{ marginTop: 6 }}>
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
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  )
}
