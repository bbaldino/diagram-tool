import { useCallback, useEffect } from 'react'

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
      }
    },
    [onCancel, onSubmit],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return (
    <div className="dlgshell__scrim" onMouseDown={onCancel}>
      <div
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
