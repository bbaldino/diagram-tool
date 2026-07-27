import { ICON_BASE } from './graph'
import { addTemplate, deleteTemplate, updateTemplate, type Model, type Template, type TemplateField } from './model'
import { useDialogs } from './Dialog'

interface Props {
  model: Model
  setModel: React.Dispatch<React.SetStateAction<Model>>
}

export function Templates({ model, setModel }: Props) {
  const { showPrompt } = useDialogs()
  const handleNew = async () => {
    const name = (await showPrompt({ title: 'New template', label: 'Name', placeholder: 'e.g. Docker service' }))?.trim()
    if (!name) return
    setModel((m) => addTemplate(m, name).model)
  }

  return (
    <div className="templates">
      <div className="templates__header">
        <h4>Templates</h4>
        <button className="templates__new" onClick={handleNew}>
          + New template
        </button>
      </div>
      {model.templates.length === 0 && <div className="templates__empty">No templates yet</div>}
      <div className="templates__list">
        {model.templates.map((t) => (
          <TemplateRow key={t.id} template={t} setModel={setModel} />
        ))}
      </div>
    </div>
  )
}

function TemplateRow({
  template,
  setModel,
}: {
  template: Template
  setModel: React.Dispatch<React.SetStateAction<Model>>
}) {
  const { showConfirm } = useDialogs()
  const patch = (p: Partial<Omit<Template, 'id'>>) => setModel((m) => updateTemplate(m, template.id, p))
  const setFields = (fields: TemplateField[]) => patch({ fields })

  const updateField = (idx: number, p: Partial<TemplateField>) => {
    setFields(template.fields.map((f, i) => (i === idx ? { ...f, ...p } : f)))
  }
  const removeField = (idx: number) => {
    setFields(template.fields.filter((_, i) => i !== idx))
  }
  const addField = () => {
    setFields([...template.fields, { key: '', showOnNode: true }])
  }

  const handleDelete = async () => {
    const ok = await showConfirm({
      title: `Delete template “${template.name}”?`,
      message: 'Entities using it keep their fields but lose the template link.',
      danger: true,
    })
    if (!ok) return
    setModel((m) => deleteTemplate(m, template.id))
  }

  return (
    <div className="templates__item">
      <div className="templates__item-top">
        {template.icon ? (
          <img className="templates__icon" src={`${ICON_BASE}/${template.icon}.svg`} alt="" />
        ) : (
          <span className="templates__icon templates__icon--placeholder">
            {template.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <input
          className="templates__name"
          value={template.name}
          placeholder="Template name"
          onChange={(e) => patch({ name: e.target.value })}
        />
      </div>
      <label className="detail__field">
        <span>Icon slug</span>
        <input
          value={template.icon ?? ''}
          placeholder="plex, sonarr, … (dashboard-icons)"
          onChange={(e) => patch({ icon: e.target.value || undefined })}
        />
      </label>

      <div className="detail__fields">
        <div className="detail__fields-header">
          <span>Fields</span>
          <button className="detail__addfield" onClick={addField}>
            + field
          </button>
        </div>
        {template.fields.map((f, i) => (
          <div className="templates__fieldrow" key={i}>
            <input placeholder="key" value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} />
            <input
              placeholder="default value"
              value={f.default ?? ''}
              onChange={(e) => updateField(i, { default: e.target.value || undefined })}
            />
            <label className="detail__fieldshow">
              <input
                type="checkbox"
                checked={!!f.showOnNode}
                onChange={(e) => updateField(i, { showOnNode: e.target.checked })}
              />
              <span>show on node (default)</span>
            </label>
            <button className="detail__fieldremove" onClick={() => removeField(i)} title="Remove field">
              ✕
            </button>
          </div>
        ))}
        {template.fields.length === 0 && <div className="detail__fields-empty">No fields yet</div>}
      </div>

      <button className="insp__delete templates__delete" onClick={handleDelete}>
        Delete template
      </button>
    </div>
  )
}
