import { useState } from 'react'
import { DialogShell } from './DialogShell'

export function DestructiveDialog(props: {
  mode: 'reset' | 'delete'
  diagramName: string
  countsText: string
  onCancel: () => void
  onConfirm: (backup: boolean) => void
}) {
  const { mode, diagramName, countsText, onCancel, onConfirm } = props
  const [backup, setBackup] = useState(false)
  const verb = mode === 'reset' ? 'Reset' : 'Delete'
  const title = `${verb} "${diagramName}"?`
  const body =
    mode === 'reset'
      ? `This removes all ${countsText}, and cannot be undone. The diagram itself stays.`
      : `This deletes the diagram and its ${countsText}, and cannot be undone.`
  const submit = () => onConfirm(backup)

  return (
    <DialogShell
      title={title}
      danger
      onCancel={onCancel}
      onSubmit={submit}
      footer={
        <>
          <button className="dlgshell__btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="dlgshell__btn dlgshell__btn--primary dlgshell__btn--danger" onClick={submit}>
            {verb} diagram
          </button>
        </>
      }
    >
      <p className="dlgshell__message">{body}</p>
      <label className="destructive__check">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        <span>Export a JSON backup first</span>
      </label>
    </DialogShell>
  )
}
