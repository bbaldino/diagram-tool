import type { Flow, FlowStep } from './model'

export function FlowPanel({
  flow, mode, selStep, onSelStep, onChange, onExit,
}: {
  flow: Flow; mode: 'edit' | 'play'; selStep: number
  onSelStep: (i: number) => void
  onChange: (steps: FlowStep[]) => void
  onExit: () => void
}) {
  const steps = flow.steps
  const setStep = (i: number, patch: Partial<FlowStep>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const addStep = () => {
    const id = `step-${Date.now().toString(36)}`
    onChange([...steps, { id, elementIds: [], caption: '' }])
    onSelStep(steps.length)
  }
  const removeStep = (i: number) => { onChange(steps.filter((_, idx) => idx !== i)); onSelStep(Math.max(0, i - 1)) }
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= steps.length) return
    const next = steps.slice(); ;[next[i], next[j]] = [next[j], next[i]]; onChange(next); onSelStep(j)
  }
  return (
    <div className="panel insp flowpanel">
      <h4>Flow: {flow.name}</h4>
      {mode === 'edit' && <div className="insp__hint">Click a canvas element to light it up in the selected step.</div>}
      {steps.map((s, i) => (
        <div key={s.id} className={`flowstep ${i === selStep ? 'sel' : ''}`} onClick={() => onSelStep(i)}>
          <div className="flowstep__head"><span className="flowstep__num">{i + 1}</span>
            {mode === 'edit' && (
              <span className="flowstep__ctl">
                <button onClick={(e) => { e.stopPropagation(); move(i, -1) }}>↑</button>
                <button onClick={(e) => { e.stopPropagation(); move(i, 1) }}>↓</button>
                <button onClick={(e) => { e.stopPropagation(); removeStep(i) }}>✕</button>
              </span>
            )}
          </div>
          {mode === 'edit'
            ? <input className="flowstep__cap" value={s.caption ?? ''} placeholder="caption…"
                onClick={(e) => e.stopPropagation()} onChange={(e) => setStep(i, { caption: e.target.value })} />
            : <div className="flowstep__capview">{s.caption || <span className="flowstep__empty">(no caption)</span>}</div>}
          <div className="flowstep__chips">
            {s.elementIds.map((id) => (
              <span key={id} className="flowstep__chip">{id}
                {mode === 'edit' && <button onClick={(e) => { e.stopPropagation(); setStep(i, { elementIds: s.elementIds.filter((x) => x !== id) }) }}>×</button>}
              </span>
            ))}
            {s.elementIds.length === 0 && <span className="flowstep__empty">no elements</span>}
          </div>
        </div>
      ))}
      {mode === 'edit' && <button className="flowstep__add" onClick={addStep}>+ Add step</button>}
      <button className="insp__action" onClick={onExit}>Exit flow</button>
    </div>
  )
}
