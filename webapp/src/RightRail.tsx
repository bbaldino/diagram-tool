export function RightRail({
  tab, onTab, flowCount, inspector, flows,
}: {
  tab: 'inspector' | 'flows'
  onTab: (t: 'inspector' | 'flows') => void
  flowCount: number
  inspector: React.ReactNode
  flows: React.ReactNode
}) {
  return (
    <div className="rightrail">
      <div className="rightrail__tabs">
        <button
          className={`rightrail__tab ${tab === 'inspector' ? 'is-active' : ''}`}
          onClick={() => onTab('inspector')}
        >
          Inspector
        </button>
        <button
          className={`rightrail__tab ${tab === 'flows' ? 'is-active' : ''}`}
          onClick={() => onTab('flows')}
        >
          Flows <span className="rightrail__badge">{flowCount}</span>
        </button>
      </div>
      <div className="rightrail__body">
        {tab === 'inspector' ? inspector : flows}
      </div>
    </div>
  )
}
