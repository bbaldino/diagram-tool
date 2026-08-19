import { DialogShell } from './DialogShell'
import { PathfindingControls } from './PathfindingControls'
import { useActiveRouting, setActiveRouting } from './routingKnobs'
import { DEFAULT_ROUTING, type DiagramRouting, type EdgeRouter } from '../shared/model'
import { sendOps } from './modelClient'

export function DiagramSettingsDialog(props: {
  diagramId: string
  committed: DiagramRouting
  onClose: () => void
}) {
  const routing = useActiveRouting()

  const cancel = () => {
    setActiveRouting(props.committed) // revert live preview
    props.onClose()
  }

  const apply = () => {
    void sendOps([{ t: 'diagram.setRouting', diagramId: props.diagramId, routing }])
    props.onClose()
  }

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
            <button type="button" onClick={apply}>
              Apply
            </button>
          </span>
        </div>
      }
    >
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
    </DialogShell>
  )
}
