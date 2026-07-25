import {
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  type NodeProps,
} from '@xyflow/react'
import { ICON_BASE } from './graph'

function initials(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function ServiceNode({ data, selected }: NodeProps) {
  const d = data as any
  const iconUrl = d.icon ? `${ICON_BASE}/${d.icon}.svg` : null
  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node__row">
        {iconUrl ? (
          <img className="node__icon" src={iconUrl} alt="" />
        ) : (
          <div className="node__icon node__icon--placeholder">
            {d.kind === 'actor' ? '👤' : initials(d.label)}
          </div>
        )}
        <div className="node__text">
          <div className="node__label">{d.label}</div>
          {d.sub ? <div className="node__sub">{d.sub}</div> : null}
        </div>
        {d.status ? (
          <div className={`node__status status-${d.status}`} title={d.status} />
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function NoteNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as any
  return (
    <div className="note">
      <NodeResizer minWidth={140} minHeight={70} isVisible={!!selected} color="#eab308" />
      <Handle type="target" position={Position.Left} />
      <textarea
        defaultValue={d.text ?? ''}
        placeholder="note…"
        onChange={(e) =>
          setNodes((ns) =>
            ns.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, text: e.target.value } } : n,
            ),
          )
        }
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function GroupNode({ data, selected }: NodeProps) {
  const d = data as any
  return (
    <div className="group" style={{ ['--group-color' as any]: d.color }}>
      <NodeResizer
        minWidth={220}
        minHeight={130}
        isVisible={!!selected}
        color={d.color}
        handleStyle={{ width: 20, height: 20, borderRadius: 4, border: '2px solid #fff' }}
        lineStyle={{ borderWidth: 12, opacity: 0 }}
      />
      <Handle type="target" position={Position.Left} />
      <div className="group__label">{d.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const nodeTypes = {
  service: ServiceNode,
  note: NoteNode,
  group: GroupNode,
}
