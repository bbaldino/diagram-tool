import { type Diagram } from './model'

interface Props {
  diagrams: Diagram[]
  activeId: string
  onSelect: (id: string) => void
  onNew: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function DiagramBar({ diagrams, activeId, onSelect, onNew, onRename, onDelete }: Props) {
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
        onClick={() => {
          const n = prompt('New diagram name?')
          if (n) onNew(n)
        }}
      >
        + Diagram
      </button>
      <button
        onClick={() => {
          const cur = diagrams.find((d) => d.id === activeId)
          const n = prompt('Rename diagram', cur?.name)
          if (n && cur) onRename(cur.id, n)
        }}
      >
        Rename
      </button>
      <button
        onClick={() => {
          if (diagrams.length > 1 && confirm('Delete this diagram? (entities are kept)')) onDelete(activeId)
        }}
      >
        Delete
      </button>
    </div>
  )
}
