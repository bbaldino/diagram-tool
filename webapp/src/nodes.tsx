import { createContext, type CSSProperties, useContext, useEffect, useRef, useState } from 'react'
import { Handle, Position, NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { ICON_BASE } from './graph'
import type {
  GroupNode as GroupNodeType,
  NoteNode as NoteNodeType,
  ServiceNode as ServiceNodeType,
} from './canvasData'
import { NoteMarkdown } from './NoteMarkdown'
import {
  resolveScheme,
  secondaryText,
  accentFill,
  NEW_NODE_SCHEME,
  NEW_NOTE_SCHEME,
} from '../shared/schemes'

// Global toggle for the browser's native spellcheck on note textareas.
// Provided by App from a persisted view preference; default off = clean viewing.
export const NoteSpellcheckContext = createContext(false)

// Connection points on all four sides, each with a stable id so edges remember
// which side they attach to. connectionMode="loose" (set on ReactFlow) lets any
// point connect to any other regardless of the source/target type.
function SideHandles() {
  return (
    <>
      <Handle id="left" type="source" position={Position.Left} />
      <Handle id="right" type="source" position={Position.Right} />
      <Handle id="top" type="source" position={Position.Top} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
    </>
  )
}

function initials(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
  const d = data
  // An icon slug that isn't in the dashboard-icons set 404s; fall back to the
  // label's initials instead of showing a broken-image glyph. Reset the failure
  // flag whenever the slug changes so a corrected icon can load.
  const [iconBroken, setIconBroken] = useState(false)
  useEffect(() => setIconBroken(false), [d.icon])
  const iconUrl = d.icon && !iconBroken ? `${ICON_BASE}/${d.icon}.svg` : null
  const scheme = resolveScheme(d.scheme ?? NEW_NODE_SCHEME, NEW_NODE_SCHEME)
  const schemeVars = {
    ['--scheme-bg']: scheme.background,
    ['--scheme-border']: scheme.border,
    ['--scheme-text']: scheme.text,
    ['--scheme-text-2']: secondaryText(scheme),
    ['--scheme-accent']: accentFill(scheme),
  } as CSSProperties
  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={schemeVars}>
      <SideHandles />
      <div className="node__row">
        {iconUrl ? (
          <img className="node__icon" src={iconUrl} alt="" onError={() => setIconBroken(true)} />
        ) : (
          <div className="node__icon node__icon--placeholder">
            {d.kind === 'actor' ? '👤' : initials(d.label)}
          </div>
        )}
        <div className="node__text">
          <div className="node__label">{d.label}</div>
          {d.sub ? <div className="node__sub">{d.sub}</div> : null}
        </div>
        {d.status ? <div className={`node__status status-${d.status}`} title={d.status} /> : null}
      </div>
      {d.shownFields && d.shownFields.length > 0 && (
        <div className="node__fields">
          {d.shownFields.map((f) => (
            <div className="node__field" key={f.key}>
              <span className="node__field-k">{f.key}</span>
              {f.value}
            </div>
          ))}
        </div>
      )}
      {d.note ? <div className="node__note">{d.note}</div> : null}
      {d.flowBadge ? <div className="node__flow-badge">{d.flowBadge}</div> : null}
    </div>
  )
}

export function NoteNode({ id, data, selected }: NodeProps<NoteNodeType>) {
  const { setNodes } = useReactFlow()
  const d = data
  const noteSpellcheck = useContext(NoteSpellcheckContext)
  const incoming = d.text ?? ''

  // The textarea is driven by local state, NOT straight off `data.text`.
  // `data.text` lives in React Flow's store and updates asynchronously, so the
  // canvas commits at least one render still carrying the pre-keystroke text.
  // Binding the textarea to that prop meant React wrote the stale string back
  // into the DOM mid-edit, and the browser then reset the caret to the end —
  // so typing anywhere but the end jumped after a single character.
  const [draft, setDraft] = useState(incoming)
  const editing = useRef(false)

  // Take text from outside (undo/redo, an MCP edit, a diagram switch) only when
  // we are not the one editing — otherwise the same lagging value clobbers the
  // keystroke we just accepted.
  useEffect(() => {
    if (!editing.current) setDraft(incoming)
  }, [incoming])

  // React does not fire onBlur for a focused element removed from the DOM,
  // so a deselect that unmounts a focused textarea would otherwise leave
  // `editing.current` stuck at true forever, permanently blocking the sync
  // effect above from picking up inbound `data.text` changes (undo, an MCP
  // edit). Deselecting always means "not editing," so reset it here too.
  useEffect(() => {
    if (!selected) editing.current = false
  }, [selected])

  const scheme = resolveScheme(d.scheme ?? NEW_NOTE_SCHEME, NEW_NOTE_SCHEME)
  const schemeVars = {
    ['--scheme-bg']: scheme.background,
    ['--scheme-border']: scheme.border,
    ['--scheme-text']: scheme.text,
    ['--scheme-text-2']: secondaryText(scheme),
    ['--scheme-accent']: accentFill(scheme),
  } as CSSProperties

  return (
    <div className={`note${selected ? ' selected' : ''}`} style={schemeVars}>
      {/* The resize lines are grab strips only — invisible, because four
          separate divs offset outward cannot meet at the corners. The visible
          selection ring is a box-shadow on the note itself. */}
      <NodeResizer
        minWidth={140}
        minHeight={70}
        isVisible={!!selected}
        handleStyle={{ width: 14, height: 14, borderRadius: 4, border: '2px solid #fff' }}
        lineStyle={{ borderWidth: 12, opacity: 0 }}
      />
      <SideHandles />
      {selected ? (
        <textarea
          autoFocus
          spellCheck={noteSpellcheck}
          value={draft}
          placeholder="note…"
          onFocus={() => {
            editing.current = true
          }}
          // Deliberately does NOT reset draft: the store may not have caught up
          // yet, and resetting here would revert what was just typed.
          onBlur={() => {
            editing.current = false
          }}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            setNodes((ns) =>
              ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: next } } : n)),
            )
          }}
        />
      ) : draft.trim() ? (
        <NoteMarkdown text={draft} />
      ) : (
        // An empty note would otherwise be an invisible yellow rectangle.
        <div className="note__placeholder">note…</div>
      )}
    </div>
  )
}

export function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  const d = data
  return (
    <div
      className={`group${selected ? ' selected' : ''}`}
      style={{ ['--group-color' as any]: d.color }}
    >
      <NodeResizer
        minWidth={220}
        minHeight={130}
        isVisible={!!selected}
        color={d.color}
        handleStyle={{ width: 20, height: 20, borderRadius: 4, border: '2px solid #fff' }}
        lineStyle={{ borderWidth: 12, opacity: 0 }}
      />
      <SideHandles />
      <div className="group__label">{d.label}</div>
    </div>
  )
}

export const nodeTypes = {
  service: ServiceNode,
  note: NoteNode,
  group: GroupNode,
}
