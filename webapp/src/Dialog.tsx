import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DialogShell } from './DialogShell'

// In-app modal dialogs — a native-looking replacement for window.prompt/confirm.
// Use the hook: const { showPrompt, showConfirm } = useDialogs()
//   const name = await showPrompt({ title: 'New diagram', label: 'Name' })
//   if (await showConfirm({ title: 'Delete?', danger: true })) …

interface PromptOpts {
  title: string
  message?: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  helperText?: string
}
interface ConfirmOpts {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type State =
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }

interface DialogApi {
  showPrompt: (opts: PromptOpts) => Promise<string | null>
  showConfirm: (opts: ConfirmOpts) => Promise<boolean>
}

const DialogContext = createContext<DialogApi | null>(null)

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialogs must be used within <DialogProvider>')
  return ctx
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null)

  const showPrompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => setState({ kind: 'prompt', opts, resolve })),
    [],
  )
  const showConfirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setState({ kind: 'confirm', opts, resolve })),
    [],
  )

  const close = useCallback(() => setState(null), [])

  return (
    <DialogContext.Provider value={{ showPrompt, showConfirm }}>
      {children}
      {state && <DialogModal state={state} close={close} />}
    </DialogContext.Provider>
  )
}

function DialogModal({ state, close }: { state: State; close: () => void }) {
  const isPrompt = state.kind === 'prompt'
  const [value, setValue] = useState(isPrompt ? (state.opts as PromptOpts).defaultValue ?? '' : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // focus the input (prompt) or the confirm button (confirm)
    const t = setTimeout(() => {
      if (isPrompt) {
        inputRef.current?.focus()
        inputRef.current?.select()
      } else {
        okRef.current?.focus()
      }
    }, 0)
    return () => clearTimeout(t)
  }, [isPrompt])

  const cancel = useCallback(() => {
    if (state.kind === 'prompt') state.resolve(null)
    else state.resolve(false)
    close()
  }, [state, close])

  const confirm = useCallback(() => {
    if (state.kind === 'prompt') state.resolve(value)
    else state.resolve(true)
    close()
  }, [state, value, close])

  const opts = state.opts
  const danger = state.kind === 'confirm' && (state.opts as ConfirmOpts).danger
  const primaryLabel = opts.confirmText ?? (isPrompt ? 'OK' : danger ? 'Delete' : 'Confirm')

  return (
    <DialogShell
      title={opts.title}
      danger={danger}
      onCancel={cancel}
      onSubmit={confirm}
      footer={
        <>
          <button className="dlgshell__btn" onClick={cancel}>
            {opts.cancelText ?? 'Cancel'}
          </button>
          <button
            ref={okRef}
            className={`dlgshell__btn dlgshell__btn--primary${danger ? ' dlgshell__btn--danger' : ''}`}
            onClick={confirm}
          >
            {primaryLabel}
          </button>
        </>
      }
    >
      {opts.message && <p className="dlgshell__message">{opts.message}</p>}
      {isPrompt && (
        <label className="dlgshell__field">
          {(opts as PromptOpts).label && <span>{(opts as PromptOpts).label}</span>}
          <input
            ref={inputRef}
            value={value}
            placeholder={(opts as PromptOpts).placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
          {(opts as PromptOpts).helperText && (
            <span className="dlgshell__helper">{(opts as PromptOpts).helperText}</span>
          )}
        </label>
      )}
    </DialogShell>
  )
}
