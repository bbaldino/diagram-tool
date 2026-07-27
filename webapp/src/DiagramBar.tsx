import { type Diagram } from './model'
import { useDialogs } from './Dialog'

interface Props {
  diagrams: Diagram[]
  activeId: string
  onSelect: (id: string) => void
  onNew: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function DiagramBar({ diagrams, activeId, onSelect, onNew, onRename, onDelete }: Props) {
  const { showPrompt, showConfirm } = useDialogs()
  return (
    <div className="panel diagrambar">
      <select value={activeId} onChange={(e) => onSelect(e.target.value)}>
        {diagrams.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button
        onClick={async () => {
          const n = (await showPrompt({ title: 'New diagram', label: 'Name', placeholder: 'e.g. Call flow' }))?.trim()
          if (n) onNew(n)
        }}
      >
        + Diagram
      </button>
      <button
        onClick={async () => {
          const cur = diagrams.find((d) => d.id === activeId)
          const n = (await showPrompt({ title: 'Rename diagram', label: 'Name', defaultValue: cur?.name }))?.trim()
          if (n && cur) onRename(cur.id, n)
        }}
      >
        Rename
      </button>
      <button
        onClick={async () => {
          if (diagrams.length < 2) return
          const ok = await showConfirm({
            title: 'Delete this diagram?',
            message: 'The diagram is removed. Entities are kept in the catalog.',
            danger: true,
          })
          if (ok) onDelete(activeId)
        }}
      >
        Delete
      </button>
    </div>
  )
}
