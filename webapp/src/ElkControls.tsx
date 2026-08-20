import { patchElk, useActiveRouting } from './routingKnobs'
import {
  DEFAULT_ELK,
  type ElkCrossingMin,
  type ElkDirection,
  type ElkEdgeRouting,
  type ElkNodePlacement,
} from '../shared/model'

// Reusable ELK layout knob controls, bound to the active diagram's routing
// config (Task 3 store). Same visual pattern as PathfindingControls.

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

export function ElkControls(): JSX.Element {
  const routing = useActiveRouting()
  const k = routing.elk ?? DEFAULT_ELK

  return (
    <div>
      <div style={rowStyle}>
        <span style={labelStyle}>direction</span>
        <select
          value={k.direction}
          onChange={(e) => patchElk({ direction: e.target.value as ElkDirection })}
        >
          <option value="RIGHT">right</option>
          <option value="DOWN">down</option>
          <option value="LEFT">left</option>
          <option value="UP">up</option>
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>edge routing</span>
        <select
          value={k.edgeRouting}
          onChange={(e) => patchElk({ edgeRouting: e.target.value as ElkEdgeRouting })}
        >
          <option value="ORTHOGONAL">orthogonal</option>
          <option value="POLYLINE">polyline</option>
          <option value="SPLINE">spline</option>
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>node placement</span>
        <select
          value={k.nodePlacement}
          onChange={(e) => patchElk({ nodePlacement: e.target.value as ElkNodePlacement })}
        >
          <option value="BRANDES_KOEPF">Brandes-Koepf</option>
          <option value="NETWORK_SIMPLEX">network simplex</option>
          <option value="SIMPLE">simple</option>
          <option value="LINEAR_SEGMENTS">linear segments</option>
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>crossing min</span>
        <select
          value={k.crossingMin}
          onChange={(e) => patchElk({ crossingMin: e.target.value as ElkCrossingMin })}
        >
          <option value="LAYER_SWEEP">layer sweep</option>
          <option value="INTERACTIVE">interactive</option>
        </select>
      </div>

      <Slider
        label="layer spacing"
        value={k.nodeNodeBetweenLayers}
        min={20}
        max={200}
        onChange={(v) => patchElk({ nodeNodeBetweenLayers: v })}
      />
      <Slider
        label="node spacing"
        value={k.nodeNode}
        min={10}
        max={120}
        onChange={(v) => patchElk({ nodeNode: v })}
      />
      <Slider
        label="edge-edge"
        value={k.edgeEdge}
        min={2}
        max={40}
        onChange={(v) => patchElk({ edgeEdge: v })}
      />
      <Slider
        label="edge-node"
        value={k.edgeNode}
        min={2}
        max={40}
        onChange={(v) => patchElk({ edgeNode: v })}
      />
    </div>
  )
}
