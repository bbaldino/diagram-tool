import { useCallback, useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'

export function DialogShell(props: {
  title: string
  width?: number
  danger?: boolean
  onCancel: () => void
  onSubmit?: () => void
  footer: React.ReactNode
  children: React.ReactNode
}) {
  const { title, width = 420, danger, onCancel, onSubmit, footer, children } = props
  const cardRef = useRef<HTMLDivElement>(null)

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && onSubmit) {
        // Don't hijack Enter inside a multiline textarea.
        const t = e.target as HTMLElement | null
        if (t && t.tagName === 'TEXTAREA') return
        e.preventDefault()
        onSubmit()
      } else if (e.key === 'Tab') {
        const card = cardRef.current
        if (!card) return
        const focusables = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null
        const activeIndex = active ? focusables.indexOf(active) : -1
        if (e.shiftKey) {
          if (activeIndex <= 0) {
            e.preventDefault()
            last.focus()
          }
        } else if (activeIndex === focusables.length - 1) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onCancel, onSubmit],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  // Initial focus: prefer the first focusable element in the dialog body,
  // falling back to the last (primary) footer button if the body has none.
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const body = card.querySelector('.dlgshell__body')
    const bodyFocusables = body ? body.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) : null
    if (bodyFocusables && bodyFocusables.length > 0) {
      bodyFocusables[0].focus()
      return
    }
    const footer = card.querySelector('.dlgshell__footer')
    const footerFocusables = footer
      ? footer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      : null
    if (footerFocusables && footerFocusables.length > 0) {
      footerFocusables[footerFocusables.length - 1].focus()
    }
  }, [])

  return (
    <div className="dlgshell__scrim" onMouseDown={onCancel}>
      <div
        ref={cardRef}
        className={`dlgshell${danger ? ' is-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dlgshell__title">{title}</div>
        <div className="dlgshell__body">{children}</div>
        <div className="dlgshell__footer">{footer}</div>
      </div>
    </div>
  )
}
