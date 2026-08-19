import { patchPathfinding, useActiveRouting } from './routingKnobs'
import type { DrawStyle, PathAlgo } from '../shared/model'

// Reusable pathfinding knob controls, bound to the active diagram's routing
// config (Task 3 store). Same visual controls as the throwaway
// RoutingKnobsPanel, but reading/writing the current per-diagram store.

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  margin: '6px 0',
  fontSize: 12,
}
const labelStyle: React.CSSProperties = { color: '#475569' }

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div style={{ ...rowStyle, opacity: props.disabled ? 0.45 : 1 }}>
      <span style={labelStyle}>
        {props.label} <b>{props.value}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  )
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ ...rowStyle, gridTemplateColumns: '18px 1fr', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span style={labelStyle}>{props.label}</span>
    </label>
  )
}

export function PathfindingControls(): JSX.Element {
  const routing = useActiveRouting()
  const k = routing.pathfinding
  const epsUsed = k.draw === 'straight' || k.draw === 'spline'

  return (
    <div>
      <div style={rowStyle}>
        <span style={labelStyle}>algorithm</span>
        <select
          value={k.algo}
          onChange={(e) => patchPathfinding({ algo: e.target.value as PathAlgo })}
        >
          <option value="no-diagonal">A* orthogonal</option>
          <option value="diagonal">A* diagonal</option>
          <option value="jump-point">jump-point</option>
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>draw</span>
        <select
          value={k.draw}
          onChange={(e) => patchPathfinding({ draw: e.target.value as DrawStyle })}
        >
          <option value="stepped">stepped</option>
          <option value="straight">straight (simplified)</option>
          <option value="smoothstep">smoothstep (rounded)</option>
          <option value="spline">spline</option>
        </select>
      </div>

      <Slider
        label="grid"
        value={k.gridRatio}
        min={4}
        max={40}
        onChange={(v) => patchPathfinding({ gridRatio: v })}
      />
      <Slider
        label="padding"
        value={k.nodePadding}
        min={0}
        max={40}
        onChange={(v) => patchPathfinding({ nodePadding: v })}
      />
      <Slider
        label="simplify"
        value={k.eps}
        min={0}
        max={20}
        disabled={!epsUsed}
        onChange={(v) => patchPathfinding({ eps: v })}
      />
      <Slider
        label="separation"
        value={k.separation ?? 0}
        min={0}
        max={30}
        onChange={(v) => patchPathfinding({ separation: v })}
      />

      <Check
        label="groups are obstacles"
        checked={k.obstacleGroups}
        onChange={(v) => patchPathfinding({ obstacleGroups: v })}
      />
      <Check
        label="notes are obstacles"
        checked={k.obstacleNotes}
        onChange={(v) => patchPathfinding({ obstacleNotes: v })}
      />
      <Check
        label="straight when clear"
        checked={k.directSkip}
        onChange={(v) => patchPathfinding({ directSkip: v })}
      />
    </div>
  )
}
