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

const API = '/api/graph'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// RF needs every parent node to appear before its children in the array.
const groupsFirst = (ns: Node[]): Node[] => [
  ...ns.filter((n) => n.type === 'group'),
  ...ns.filter((n) => n.type !== 'group'),
]

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [selNode, setSelNode] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [edgeStyle, setEdgeStyle] = useState<'default' | 'smoothstep' | 'straight'>('default')
  const rf = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0 })

  const save = useCallback((n: Node[], e: Edge[]) => {
    setSaveState('saving')
    fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: n, edges: e }, null, 2),
    })
      .then((r) => setSaveState(r.ok ? 'saved' : 'error'))
      .catch(() => setSaveState('error'))
  }, [])

  // Load graph.json (source of truth); seed the file on first run.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(API)
        if (res.status === 200) {
          const p = await res.json()
          if (!cancelled && p?.nodes?.length) {
            const migrated = (p.edges ?? []).map((e: any) => ({
              ...e,
              type: 'waypoint',
              data: {
                ...(e.data || {}),
                shape: e.data?.shape ?? (e.type && e.type !== 'waypoint' ? e.type : 'default'),
              },
            }))
            setNodes(p.nodes)
            setEdges(migrated)
            setEdgeStyle((migrated[0]?.data?.shape as any) || 'default')
            loaded.current = true
            setSaveState('saved')
            setTimeout(() => rf.fitView({ padding: 0.2 }), 60)
            return
          }
        }
      } catch {
        /* server offline — fall through to seed */
      }
      const s = buildSeed()
      if (cancelled) return
      setNodes(s.nodes)
      setEdges(s.edges)
      loaded.current = true
      save(s.nodes, s.edges)
      setTimeout(() => rf.fitView({ padding: 0.2 }), 60)
    })()
    return () => {
      cancelled = true
    }
  }, [rf, setNodes, setEdges, save])

  // Autosave edits back to the file (debounced), once initial load is done.
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(() => save(nodes, edges), 500)
    return () => clearTimeout(t)
  }, [nodes, edges, save])

  const onSelectionChange = useCallback(
    ({ nodes: sn, edges: se }: { nodes: Node[]; edges: Edge[] }) => {
      setSelNode(sn[0]?.id ?? null)
      setSelEdge(se[0]?.id ?? null)
    },
    [],
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

  const addService = useCallback(() => {
    const id = `svc-${Date.now()}`
    const parent = nodes.find((n) => n.id === selNode && n.type === 'group')
    const base = parent
      ? { parentId: parent.id, extent: 'parent' as const, position: { x: 24, y: 52 } }
      : { position: rf.screenToFlowPosition({ x: window.innerWidth / 2, y: 200 }) }
    const newNode = {
      id,
      type: 'service',
      data: { label: 'new-service', sub: '', status: 'up' },
      selected: true,
      ...base,
    } as Node
    setNodes((ns) => groupsFirst([...ns.map((n) => ({ ...n, selected: false })), newNode] as Node[]))
    setSelNode(id)
    setSelEdge(null)
  }, [rf, nodes, selNode, setNodes])

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
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'homelab-canvas.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [nodes, edges])

  const onImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (!f) return
      f.text().then((t) => {
        try {
          const p = JSON.parse(t)
          if (p.nodes && p.edges) {
            setNodes(p.nodes)
            setEdges(p.edges)
          }
        } catch {
          /* ignore bad file */
        }
      })
      e.target.value = ''
    },
    [setNodes, setEdges],
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
    save(s.nodes, s.edges)
    setTimeout(() => rf.fitView({ padding: 0.2 }), 40)
  }, [rf, setNodes, setEdges, save])

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
        ? '✓ saved to graph.json'
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
            <button onClick={addService}>+ Service</button>
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
          />
        </Panel>

        <Panel position="top-left" className="panel">
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
