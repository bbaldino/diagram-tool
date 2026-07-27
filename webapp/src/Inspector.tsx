import { type Node, type Edge } from '@xyflow/react'
import { REL, type RelType, type EdgeDir } from './graph'
import { ColorPicker } from './ColorPicker'

interface Props {
  node: Node | null
  edge: Edge | null
  groups: { id: string; label: string }[]
  onNodeData: (patch: Record<string, unknown>) => void
  onNodeParent: (parentId: string) => void
  onEdge: (patch: { type?: RelType; label?: string; inferred?: boolean; dir?: EdgeDir; color?: string }) => void
  diagramColors: string[]
  onDistribute: () => void
  onShrink: () => void
  onGroupSize: (size: { width?: number; height?: number }) => void
  onDelete: () => void
  onRemoveFromDiagram: () => void
  onDeleteEntity: () => void
  fields: { key: string; value: string; effective: boolean; overridden: boolean }[]
  onFieldShow: (key: string, value: boolean | undefined) => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="insp__field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Inspector({
  node,
  edge,
  groups,
  onNodeData,
  onNodeParent,
  onEdge,
  onDistribute,
  onShrink,
  onGroupSize,
  onDelete,
  onRemoveFromDiagram,
  onDeleteEntity,
  fields,
  onFieldShow,
  diagramColors,
}: Props) {
  // ----- edge selected -----
  if (edge && !node) {
    const d = (edge.data ?? {}) as any
    const type = (d.rel as RelType) ?? 'talks-to'
    const dir = (d.dir as EdgeDir) ?? 'forward'
    const colorOverridden = typeof d.color === 'string'
    const color = colorOverridden ? (d.color as string) : REL[type].color
    const DIRS: { v: EdgeDir; glyph: string; title: string }[] = [
      { v: 'forward', glyph: '→', title: 'one-way (arrow at target)' },
      { v: 'backward', glyph: '←', title: 'reversed (arrow at source)' },
      { v: 'both', glyph: '↔', title: 'two-way (arrows at both ends)' },
    ]
    return (
      <div className="panel insp">
        <h4>Edit edge</h4>
        <div className="insp__sub">
          {String(edge.source)} → {String(edge.target)}
        </div>
        <Field label="Direction">
          <div className="insp__dir">
            {DIRS.map((o) => (
              <button
                key={o.v}
                type="button"
                title={o.title}
                className={dir === o.v ? 'active' : ''}
                onClick={() => onEdge({ dir: o.v })}
              >
                {o.glyph}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <ColorPicker
            value={color}
            overridden={colorOverridden}
            defaultLabel="default"
            diagramColors={diagramColors}
            onChange={(hex) => onEdge({ color: hex })}
            onReset={() => onEdge({ color: undefined })}
          />
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
        <div className="insp__sub">shared across diagrams</div>
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
        <Field label="Note (this diagram)">
          <textarea
            className="insp__note"
            value={d.note ?? ''}
            placeholder="shown inside this box, on this diagram only"
            onChange={(e) => onNodeData({ note: e.target.value || undefined })}
          />
        </Field>
        {fields.length > 0 && (
          <div className="insp__fields">
            <div className="insp__fields-title">Fields on this node</div>
            {fields.map((f) => (
              <div className="insp__fields-row" key={f.key}>
                <label className="insp__check insp__fields-check">
                  <input
                    type="checkbox"
                    checked={f.effective}
                    onChange={(e) => onFieldShow(f.key, e.target.checked)}
                  />
                  <span>{f.key}</span>
                </label>
                {f.overridden && (
                  <button
                    type="button"
                    className="insp__fields-reset"
                    onClick={() => onFieldShow(f.key, undefined)}
                  >
                    reset
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <button className="insp__action" onClick={onRemoveFromDiagram}>
          Remove from this diagram
        </button>
        <button className="insp__delete" onClick={onDeleteEntity}>
          Delete entity (all diagrams)
        </button>
      </div>
    )
  }

  // ----- nothing selected -----
  return (
    <div className="panel insp insp--empty">
      <h4>Inspector</h4>
      <div className="insp__hint">
        Select a node, group, or edge to edit its fields. Add entities from the <b>palette</b>{' '}
        (bottom-left); use <b>+ Group</b> / <b>+ Note</b> for diagram structure.
      </div>
    </div>
  )
}
