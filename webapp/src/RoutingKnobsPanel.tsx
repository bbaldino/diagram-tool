import {
  DEFAULT_KNOBS,
  resetRoutingKnobs,
  setRoutingKnobs,
  useRoutingKnobs,
  type DrawStyle,
  type PathAlgo,
} from './routingKnobs'

// DEMO scaffolding: live controls for the pathfinding-edge knobs. Throwaway —
// lives only on the edge-routing branch alongside SmartTestEdge.

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

export function RoutingKnobsPanel() {
  const k = useRoutingKnobs()
  const epsUsed = k.draw === 'straight' || k.draw === 'spline'
  return (
    <div className="panel" style={{ width: 250 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Edge routing (demo)</h4>
        <button
          type="button"
          onClick={resetRoutingKnobs}
          style={{ fontSize: 11, cursor: 'pointer' }}
          title="Reset to defaults"
        >
          reset
        </button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>algorithm</span>
        <select
          value={k.algo}
          onChange={(e) => setRoutingKnobs({ algo: e.target.value as PathAlgo })}
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
          onChange={(e) => setRoutingKnobs({ draw: e.target.value as DrawStyle })}
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
        onChange={(v) => setRoutingKnobs({ gridRatio: v })}
      />
      <Slider
        label="padding"
        value={k.nodePadding}
        min={0}
        max={40}
        onChange={(v) => setRoutingKnobs({ nodePadding: v })}
      />
      <Slider
        label="simplify"
        value={k.eps}
        min={0}
        max={20}
        disabled={!epsUsed}
        onChange={(v) => setRoutingKnobs({ eps: v })}
      />

      <Check
        label="groups are obstacles"
        checked={k.obstacleGroups}
        onChange={(v) => setRoutingKnobs({ obstacleGroups: v })}
      />
      <Check
        label="notes are obstacles"
        checked={k.obstacleNotes}
        onChange={(v) => setRoutingKnobs({ obstacleNotes: v })}
      />
      <Check
        label="straight when clear"
        checked={k.directSkip}
        onChange={(v) => setRoutingKnobs({ directSkip: v })}
      />

      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
        defaults: {DEFAULT_KNOBS.algo} · grid {DEFAULT_KNOBS.gridRatio} · pad{' '}
        {DEFAULT_KNOBS.nodePadding}
      </div>
    </div>
  )
}
