import { stepCounterLabel, isStepPlayed } from './flowPlayback'

export function StepBar(props: {
  stepIndex: number
  stepCount: number
  onBack: () => void
  onNext: () => void
  onExit: () => void
  onScrub: (index: number) => void
}) {
  const { stepIndex, stepCount, onBack, onNext, onExit, onScrub } = props
  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= stepCount - 1

  return (
    <div className="stepbar" role="group" aria-label="Flow walkthrough">
      <div className="stepbar__buttons">
        <button type="button" className="stepbar__back" onClick={onBack} disabled={atStart}>
          ← Back
        </button>
        <button
          type="button"
          className="stepbar__next"
          // On the last step "Next" becomes "Finish", which exits the flow.
          onClick={atEnd ? onExit : onNext}
        >
          {atEnd ? 'Finish' : 'Next step →'}
        </button>
      </div>

      <div className="stepbar__counter">{stepCounterLabel(stepIndex, stepCount)}</div>

      <div className="stepbar__scrub">
        {Array.from({ length: stepCount }, (_, i) => (
          <button
            type="button"
            key={i}
            className={`stepbar__bar${isStepPlayed(i, stepIndex) ? ' is-on' : ''}`}
            onClick={() => onScrub(i)}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      <button type="button" className="stepbar__exit" onClick={onExit}>
        Exit flow
      </button>
    </div>
  )
}
