import { useState } from 'react'
import { DialogShell } from './DialogShell'
import { PathfindingControls } from './PathfindingControls'
import { ElkControls } from './ElkControls'
import { useActiveRouting, setActiveRouting } from './routingKnobs'
import {
  DEFAULT_ROUTING,
  type DiagramRouting,
  type DiagramType,
  type EdgeRouter,
} from '../shared/model'
import { sendOps } from './modelClient'
import type { Op } from '../shared/ops'

const DIAGRAM_TYPES: { value: DiagramType; label: string }[] = [
  { value: 'canvas', label: 'Canvas' },
  { value: 'topology', label: 'Topology' },
  { value: 'call-flow', label: 'Call-flow' },
]

export function DiagramSettingsDialog(props: {
  diagramId: string
  committed: DiagramRouting
  type: DiagramType
  onClose: () => void
  onTidy: () => void
}) {
  const routing = useActiveRouting()
  const [selType, setSelType] = useState<DiagramType>(props.type)
  const typeChanged = selType !== props.type

  const cancel = () => {
    setActiveRouting(props.committed) // revert live preview
    props.onClose()
  }

  // Commit routing and/or type in one op batch. A type change swaps the layout
  // engine, so it always re-Tidies; the waypoint "Apply & Tidy" button also does.
  const commit = async (tidy: boolean) => {
    const ops: Op[] = []
    if (JSON.stringify(routing) !== JSON.stringify(props.committed)) {
      ops.push({ t: 'diagram.setRouting', diagramId: props.diagramId, routing })
    }
    if (typeChanged) {
      ops.push({ t: 'diagram.setType', diagramId: props.diagramId, type: selType })
    }
    if (ops.length) await sendOps(ops)
    if (tidy || typeChanged) props.onTidy()
    props.onClose()
  }

  const apply = () => void commit(false)
  const applyAndTidy = () => void commit(true)

  return (
    <DialogShell
      title="Diagram settings"
      onCancel={cancel}
      onSubmit={apply}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button type="button" onClick={() => setActiveRouting(DEFAULT_ROUTING)}>
            Reset to defaults
          </button>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            {routing.router === 'waypoint' ? (
              <button type="button" onClick={applyAndTidy}>
                Apply &amp; Tidy
              </button>
            ) : null}
            <button type="button" onClick={apply}>
              Apply
            </button>
          </span>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '4px 0 12px' }}>
        <span>Diagram type:</span>
        <select
          value={selType}
          onChange={(e) => setSelType(e.target.value as DiagramType)}
          aria-label="Diagram type"
        >
          {DIAGRAM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {typeChanged ? (
          <span style={{ fontSize: 12, color: '#64748b' }}>changes on Apply (re-tidies)</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '4px 0 12px' }}>
        <span>Edge router:</span>
        {(['waypoint', 'pathfinding'] as EdgeRouter[]).map((r) => (
          <label key={r} style={{ display: 'flex', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="router"
              checked={routing.router === r}
              onChange={() => setActiveRouting({ ...routing, router: r })}
            />
            {r === 'waypoint' ? 'Waypoint (ELK)' : 'Pathfinding (A*)'}
          </label>
        ))}
      </div>
      {routing.router === 'pathfinding' ? <PathfindingControls /> : null}
      {routing.router === 'waypoint' ? <ElkControls /> : null}
    </DialogShell>
  )
}
