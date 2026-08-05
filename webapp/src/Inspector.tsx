import { type Node, type Edge } from '@xyflow/react'
import { REL, type RelType, type EdgeDir } from './graph'
import { ColorPicker } from './ColorPicker'
import { SchemePicker } from './SchemePicker'
import { isGroupNode, isNoteNode, isServiceNode } from './nodeData'
import { IconInput } from './IconInput'
import { Switch } from './Switch'
import { NEW_NODE_SCHEME, NEW_NOTE_SCHEME } from './schemes'

interface Props {
  node: Node | null
  edge: Edge | null
  groups: { id: string; label: string }[]
  onNodeData: (patch: Record<string, unknown>) => void
  onNodeParent: (parentId: string) => void
  onEdge: (patch: {
    type?: RelType
    label?: string
    inferred?: boolean
    dir?: EdgeDir
    color?: string
  }) => void
  // Plain hexes only — from edges and groups. For the edge/group pickers.
  diagramColors: string[]
  // Scheme names or custom hexes — from notes and service nodes. For the
  // note/service-node pickers. Never pass diagramColors to those pickers or
  // diagramSchemes to the edge/group pickers: a scheme name rendered as a
  // CSS color, or vice versa, corrupts the stored value.
  diagramSchemes: string[]
  onShrink: () => void
  onGroupSize: (size: { width?: number; height?: number }) => void
  onDelete: () => void
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
  onShrink,
  onGroupSize,
  onDelete,
  fields,
  onFieldShow,
  diagramColors,
  diagramSchemes,
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
        <div className="insp__header">
          <h4>Edit edge</h4>
          <span className="insp__chip">Edge</span>
        </div>
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
            diagramColors={diagramColors}
            onChange={(hex) => onEdge({ color: hex })}
            defaultSwatch={{ background: REL[type].color, border: REL[type].color }}
            isDefault={!colorOverridden}
            onSelectDefault={() => onEdge({ color: undefined })}
          />
        </Field>
        <Field label="Label">
          <input
            value={(edge.label as string) ?? ''}
            placeholder="(optional)"
            onChange={(e) => onEdge({ label: e.target.value })}
          />
        </Field>
        <Switch
          checked={!!d.inferred}
          onChange={(v) => onEdge({ inferred: v })}
          label="Inferred (dashed)"
        />
        <button className="insp__delete" onClick={onDelete}>
          Delete edge
        </button>
      </div>
    )
  }

  // ----- group selected -----
  if (node && isGroupNode(node)) {
    const d = node.data
    const g = node as any
    const curW = Math.round(
      Number(g.measured?.width) || Number(g.style?.width) || Number(g.width) || 0,
    )
    const curH = Math.round(
      Number(g.measured?.height) || Number(g.style?.height) || Number(g.height) || 0,
    )
    return (
      <div className="panel insp">
        <div className="insp__header">
          <h4>Edit group</h4>
          <span className="insp__chip">Group</span>
        </div>
        <Field label="Label">
          <input value={d.label ?? ''} onChange={(e) => onNodeData({ label: e.target.value })} />
        </Field>
        <Field label="Color">
          <ColorPicker
            value={d.color ?? '#64748b'}
            diagramColors={diagramColors}
            onChange={(hex) => onNodeData({ color: hex })}
            defaultSwatch={{ background: '#64748b', border: '#64748b' }}
            isDefault={d.color === '#64748b'}
            onSelectDefault={() => onNodeData({ color: '#64748b' })}
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
        <Field label="Parent group">
          <select value={node.parentId ?? ''} onChange={(e) => onNodeParent(e.target.value)}>
            <option value="">(none)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <button className="insp__action" onClick={onShrink}>
          Shrink to fit
        </button>
        <button className="insp__delete" onClick={onDelete}>
          Delete group (+ its contents)
        </button>
      </div>
    )
  }

  // ----- note selected -----
  if (node && isNoteNode(node)) {
    const d = node.data
    return (
      <div className="panel insp">
        <div className="insp__header">
          <h4>Edit note</h4>
          <span className="insp__chip">Note</span>
        </div>
        <div className="insp__hint">Edit the text directly on the note.</div>
        <Field label="Color">
          <SchemePicker
            value={(d.scheme as string) ?? NEW_NOTE_SCHEME}
            diagramSchemes={diagramSchemes}
            onChange={(v) => onNodeData({ scheme: v })}
          />
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
          Delete note
        </button>
      </div>
    )
  }

  // ----- service node selected -----
  if (node && isServiceNode(node)) {
    const d = node.data
    return (
      <div className="panel insp">
        <div className="insp__header">
          <h4>Edit node</h4>
          <span className="insp__chip">Entity</span>
        </div>
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
          <IconInput
            value={d.icon}
            onChange={(v) => onNodeData({ icon: v })}
            placeholder="plex, sonarr, … (dashboard-icons)"
          />
        </Field>
        <Field label="Color">
          <SchemePicker
            value={(d.scheme as string) ?? NEW_NODE_SCHEME}
            diagramSchemes={diagramSchemes}
            onChange={(v) => onNodeData({ scheme: v })}
          />
        </Field>
        <Field label="Status">
          <select
            value={d.status ?? ''}
            onChange={(e) => onNodeData({ status: e.target.value || undefined })}
          >
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
        <Field label="Note">
          <textarea
            className="insp__note"
            value={d.note ?? ''}
            placeholder="shown inside this box"
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
        <button className="insp__delete" onClick={onDelete}>
          Delete node
        </button>
      </div>
    )
  }

  // ----- nothing selected -----
  return (
    <div className="panel insp insp--empty">
      <div className="insp__empty-tile">◇</div>
      <div className="insp__empty-title">Nothing selected</div>
      <div className="insp__empty-body">
        Select a node, group, or edge to edit its fields. Double-click the canvas and choose{' '}
        <b>Add → Entity</b> to create one; use <b>+ Group</b> / <b>+ Note</b> for diagram structure.
      </div>
    </div>
  )
}
