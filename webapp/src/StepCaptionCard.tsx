import { stepCounterLabel } from './flowPlayback'

export function StepCaptionCard(props: {
  stepIndex: number
  stepCount: number
  flowName: string
  elementSummary: string
  description: string
}) {
  const { stepIndex, stepCount, flowName, elementSummary, description } = props
  return (
    <div className="stepcard" role="status" aria-live="polite">
      <div className="stepcard__meta">
        <span className="stepcard__pill">Step {stepCounterLabel(stepIndex, stepCount)}</span>
        <span className="stepcard__flow">{flowName}</span>
        {elementSummary && <span className="stepcard__summary">{elementSummary}</span>}
      </div>
      <div className="stepcard__desc">{description || 'No description for this step.'}</div>
    </div>
  )
}
