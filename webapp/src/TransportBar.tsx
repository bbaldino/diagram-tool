import { useEffect, useRef, useState } from 'react'
import { transportSublabel, isStepPlayed } from './flowPlayback'

export function TransportBar(props: {
  flowName: string
  stepIndex: number
  stepCount: number
  caption?: string
  playing: boolean
  speed: number
  speeds: readonly number[]
  onPrev: () => void
  onNext: () => void
  onTogglePlay: () => void
  onScrub: (index: number) => void
  onSetSpeed: (speed: number) => void
  onExit: () => void
}) {
  const {
    flowName,
    stepIndex,
    stepCount,
    caption,
    playing,
    speed,
    speeds,
    onPrev,
    onNext,
    onTogglePlay,
    onScrub,
    onSetSpeed,
    onExit,
  } = props

  const [speedOpen, setSpeedOpen] = useState(false)
  const speedWrap = useRef<HTMLDivElement | null>(null)

  // Close the speed popover on any outside pointer-down. Capture phase because
  // React Flow's d3-zoom stops propagation on the canvas (bubble-phase misses).
  useEffect(() => {
    if (!speedOpen) return
    const onDown = (e: MouseEvent) => {
      if (!speedWrap.current?.contains(e.target as Node)) setSpeedOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [speedOpen])

  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= stepCount - 1

  return (
    <div className="transport" role="group" aria-label="Flow playback">
      <div className="transport__buttons">
        <button
          type="button"
          className="transport__btn"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous step"
        >
          ⏮
        </button>
        <button
          type="button"
          className="transport__btn transport__btn--play"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="transport__btn"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next step"
        >
          ⏭
        </button>
      </div>

      <div className="transport__label">
        <div className="transport__name">{flowName}</div>
        <div className="transport__sub">{transportSublabel(stepIndex, stepCount, caption)}</div>
      </div>

      <div className="transport__scrub">
        {Array.from({ length: stepCount }, (_, i) => (
          <button
            type="button"
            key={i}
            className={`transport__bar${isStepPlayed(i, stepIndex) ? ' is-on' : ''}`}
            onClick={() => onScrub(i)}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      <div className="transport__right">
        <div className="transport__speedwrap" ref={speedWrap}>
          <button
            type="button"
            className="transport__speed"
            onClick={() => setSpeedOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={speedOpen}
          >
            {speed}× ▾
          </button>
          {speedOpen && (
            <div className="transport__speedmenu" role="menu">
              {speeds.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`transport__speeditem${s === speed ? ' is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={s === speed}
                  onClick={() => {
                    onSetSpeed(s)
                    setSpeedOpen(false)
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="transport__exit" onClick={onExit}>
          Exit flow
        </button>
      </div>
    </div>
  )
}
