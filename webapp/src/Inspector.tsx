import { type Node, type Edge } from '@xyflow/react'
import { REL, REL_TYPES, type RelType } from './graph'

interface Props {
  node: Node | null
  edge: Edge | null
  groups: { id: string; label: string }[]
  onNodeData: (patch: Record<string, unknown>) => void
  onNodeParent: (parentId: string) => void
  onEdge: (patch: { type?: RelType; label?: string; inferred?: boolean }) => void
  onDistribute: () => void
  onShrink: () => void
  onGroupSize: (size: { width?: number; height?: number }) => void
  onDelete: () => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="insp__field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Inspector({ node, edge, groups, onNodeData, onNodeParent, onEdge, onDistribute, onShrink, onGroupSize, onDelete }: Props) {
  // ----- edge selected -----
  if (edge && !node) {
    const d = (edge.data ?? {}) as any
    const type = (d.rel as RelType) ?? 'talks-to'
    return (
      <div className="panel insp">
        <h4>Edit edge</h4>
        <div className="insp__sub">
          {String(edge.source)} → {String(edge.target)}
        </div>
        <Field label="Relationship">
          <select value={type} onChange={(e) => onEdge({ type: e.target.value as RelType })}>
            {REL_TYPES.map((t) => (
              <option key={t} value={t}>
                {REL[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            value={(edge.label as string) ?? ''}
            placeholder="(optional)"
            onChange={(e) => onEdge({ label: e.target.value })}
          />
        </Field>
        <label className="insp__check">
          <input
            type="checkbox"
            checked={!!d.inferred}
            onChange={(e) => onEdge({ inferred: e.target.checked })}
          />
          <span>inferred (dashed guess)</span>
        </label>
        <button className="insp__delete" onClick={onDelete}>
          Delete edge
        </button>
      </div>
    )
  }

  // ----- group selected -----
  if (node && node.type === 'group') {
    const d = node.data as any
    const g = node as any
    const curW = Math.round(Number(g.measured?.width) || Number(g.style?.width) || Number(g.width) || 0)
    const curH = Math.round(Number(g.measured?.height) || Number(g.style?.height) || Number(g.height) || 0)
    return (
      <div className="panel insp">
        <h4>Edit group</h4>
        <Field label="Label">
          <input value={d.label ?? ''} onChange={(e) => onNodeData({ label: e.target.value })} />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={d.color ?? '#64748b'}
            onChange={(e) => onNodeData({ color: e.target.value })}
          />
        </Field>
        <div className="insp__row2">
          <Field label="Width">
            <input
              type="number"
              min={120}
              key={`w${curW}`}
              defaultValue={curW}
              onBlur={(e) => onGroupSize({ width: Math.max(120, Number(e.target.value) || curW) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              min={120}
              key={`h${curH}`}
              defaultValue={curH}
              onBlur={(e) => onGroupSize({ height: Math.max(120, Number(e.target.value) || curH) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </Field>
        </div>
        <button className="insp__action" onClick={onDistribute}>
          Space to fit
        </button>
        <button className="insp__action" onClick={onShrink}>
          Shrink to fit
        </button>
        <button className="insp__delete" onClick={onDelete}>
          Delete group (+ its nodes)
        </button>
      </div>
    )
  }

  // ----- service node selected -----
  if (node) {
    const d = node.data as any
    return (
      <div className="panel insp">
        <h4>Edit node</h4>
        <Field label="Label">
          <input value={d.label ?? ''} onChange={(e) => onNodeData({ label: e.target.value })} />
        </Field>
        <Field label="Sub / port">
          <input
            value={d.sub ?? ''}
            placeholder=":8080"
            onChange={(e) => onNodeData({ sub: e.target.value })}
          />
        </Field>
        <Field label="Icon slug">
          <input
            value={d.icon ?? ''}
            placeholder="plex, sonarr, … (dashboard-icons)"
            onChange={(e) => onNodeData({ icon: e.target.value || undefined })}
          />
        </Field>
        <Field label="Status">
          <select value={d.status ?? ''} onChange={(e) => onNodeData({ status: e.target.value || undefined })}>
            <option value="">(none)</option>
            <option value="up">up</option>
            <option value="down">down</option>
            <option value="idle">idle</option>
          </select>
        </Field>
        <Field label="Group">
          <select value={node.parentId ?? ''} onChange={(e) => onNodeParent(e.target.value)}>
            <option value="">(none)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <button className="insp__delete" onClick={onDelete}>
          Delete node
        </button>
      </div>
    )
  }

  // ----- nothing selected -----
  return (
    <div className="panel insp insp--empty">
      <h4>Inspector</h4>
      <div className="insp__hint">
        Select a node, group, or edge to edit its fields. Use <b>+ Service</b> / <b>+ Group</b> to
        add new ones (a selected group becomes the parent).
      </div>
    </div>
  )
}
