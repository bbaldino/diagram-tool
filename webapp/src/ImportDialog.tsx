import { useRef, useState } from 'react'
import { normalizeModel, type Model } from './model'
import { DialogShell } from './DialogShell'

type Parsed =
  | { ok: true; model: Model; fileName: string; diagramCount: number }
  | { ok: false; fileName: string; error: string }

export function ImportDialog(props: {
  onCancel: () => void
  onImport: (model: Model, asNew: boolean) => void
}) {
  const { onCancel, onImport } = props
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [asNew, setAsNew] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    file.text().then((text) => {
      try {
        const raw = JSON.parse(text)
        const model = normalizeModel(raw)
        if (model.diagrams.length === 0) {
          // normalizeModel maps any valid-JSON-but-not-a-model file (or an old
          // catalog-shaped file) to an empty model. Treat that as an error so the
          // replace path can't silently wipe the whole model with nothing.
          setParsed({ ok: false, fileName: file.name, error: 'No diagrams found in this file' })
          return
        }
        setParsed({ ok: true, model, fileName: file.name, diagramCount: model.diagrams.length })
      } catch (err) {
        const msg = err instanceof SyntaxError ? err.message : 'Not valid JSON.'
        setParsed({ ok: false, fileName: file.name, error: msg })
      }
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const valid = parsed?.ok === true
  const submit = () => {
    if (parsed?.ok) onImport(parsed.model, asNew)
  }

  return (
    <DialogShell
      title="Import JSON"
      onCancel={onCancel}
      onSubmit={valid ? submit : undefined}
      footer={
        <>
          <button className="dlgshell__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="dlgshell__btn dlgshell__btn--primary"
            onClick={submit}
            disabled={!valid}
          >
            Import
          </button>
        </>
      }
    >
      <div
        className={`importdlg__drop${dragOver ? ' is-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="importdlg__drop-title">Drop a .json file</div>
        <div className="importdlg__drop-sub">or click to browse</div>
        {parsed?.ok && (
          <div className="importdlg__drop-file">
            {parsed.fileName} · {parsed.diagramCount} diagram{parsed.diagramCount === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
      {parsed && !parsed.ok && (
        <div className="importdlg__error">
          <div className="importdlg__error-title">
            <span className="importdlg__error-bang">!</span> Couldn't import {parsed.fileName}
          </div>
          <div className="importdlg__error-body">
            {parsed.error}. Nothing was imported.
          </div>
        </div>
      )}
      <label className="importdlg__toggle">
        <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
        <span>Import into a new diagram</span>
      </label>
    </DialogShell>
  )
}
