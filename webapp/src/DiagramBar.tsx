import { type Diagram } from './model'

interface Props {
  diagrams: Diagram[]
  activeId: string
  onSelect: (id: string) => void
}

export function DiagramBar({ diagrams, activeId, onSelect }: Props) {
  return (
    <div className="panel diagrambar">
      <select value={activeId} onChange={(e) => onSelect(e.target.value)}>
        {diagrams.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  )
}
