export function DiagramTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  meta,
}: {
  tabs: { id: string; name: string }[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  meta: { entities: number; groups: number; edges: number } | null
}) {
  return (
    <div className="tabstrip">
      <div className="tabstrip__tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={`tab${isActive ? ' is-active' : ''}`}
              onClick={() => onSelect(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(tab.id)
                }
              }}
            >
              <span className="tab__label">{tab.name}</span>
              <span
                className="tab__close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                ×
              </span>
            </div>
          )
        })}
        <button type="button" className="tabstrip__new" onClick={onNew}>
          +
        </button>
      </div>
      {meta && (
        <div className="tabstrip__meta">
          {meta.entities} entities · {meta.groups} groups · {meta.edges} edges
        </div>
      )}
    </div>
  )
}
