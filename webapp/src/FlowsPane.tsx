import type { Flow, FlowStep } from './model'
import { FlowPanel } from './FlowPanel'

export function FlowsPane({
  flows, currentFlowId, onSelectFlow, onCreateFlow, flowMode, onSetMode,
  currentFlow, selStep, currentStep, onSelStep, onStepsChange, onExit,
  onRenameFlow, onDeleteFlow,
}: {
  flows: Flow[]
  currentFlowId: string | null
  onSelectFlow: (id: string | null) => void
  onCreateFlow: () => void
  flowMode: 'none' | 'edit' | 'play'
  onSetMode: (m: 'none' | 'edit' | 'play') => void
  currentFlow: Flow | null
  selStep: number
  currentStep: number
  onSelStep: (i: number) => void
  onStepsChange: (steps: FlowStep[]) => void
  onExit: () => void
  onRenameFlow: (id: string) => void
  onDeleteFlow: (id: string) => void
}) {
  return (
    <div className="panel toolbar">
      <label className="edgestyle">
        Flow:
        <select
          value={currentFlowId ?? ''}
          onChange={(e) => onSelectFlow(e.target.value || null)}
        >
          <option value="">(none)</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <button onClick={onCreateFlow}>+ Flow</button>
      <button
        onClick={() => onSetMode(flowMode === 'edit' ? 'none' : 'edit')}
        disabled={!currentFlow}
        className={flowMode === 'edit' ? 'active' : ''}
      >
        Edit
      </button>
      <button
        onClick={() => onSetMode(flowMode === 'play' ? 'none' : 'play')}
        disabled={!currentFlow}
        className={flowMode === 'play' ? 'active' : ''}
      >
        Play
      </button>
      <button onClick={() => currentFlowId && onRenameFlow(currentFlowId)} disabled={!currentFlow}>
        Rename
      </button>
      <button onClick={() => currentFlowId && onDeleteFlow(currentFlowId)} disabled={!currentFlow}>
        Delete
      </button>
      {currentFlow && flowMode !== 'none' && (
        <FlowPanel
          flow={currentFlow}
          mode={flowMode === 'edit' ? 'edit' : 'play'}
          selStep={flowMode === 'edit' ? selStep : currentStep}
          onSelStep={onSelStep}
          onChange={onStepsChange}
          onExit={onExit}
        />
      )}
    </div>
  )
}
