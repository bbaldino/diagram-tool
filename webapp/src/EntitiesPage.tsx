import { useMemo, useState } from 'react'
import { ICON_BASE } from './graph'
import {
  addEntity,
  applyTemplate,
  deleteEntity,
  setEntityFields,
  updateEntity,
  type Entity,
  type EntityField,
  type Model,
  type Status,
  type Template,
} from './model'
import { Templates } from './Templates'
import { useDialogs } from './Dialog'

interface Props {
  model: Model
  setModel: React.Dispatch<React.SetStateAction<Model>>
  onJump: (id: string) => void
}

function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'entity'
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function EntitiesPage({ model, setModel, onJump }: Props) {
  const { showPrompt, showConfirm } = useDialogs()
  const [search, setSearch] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [usedInOpenFor, setUsedInOpenFor] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<'entities' | 'templates'>('entities')

  const templatesById = useMemo(
    () => Object.fromEntries(model.templates.map((t) => [t.id, t])),
    [model.templates],
  )

  // entityId -> diagrams that place it
  const usedInByEntity = useMemo(() => {
    const map: Record<string, { id: string; name: string }[]> = {}
    for (const e of model.entities) map[e.id] = []
    for (const d of model.diagrams) {
      const placed = new Set(d.placements.map((p) => p.entityId))
      for (const id of placed) {
        if (map[id]) map[id].push({ id: d.id, name: d.name })
      }
    }
    return map
  }, [model.entities, model.diagrams])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return model.entities.filter((e) => {
      if (templateFilter && e.template !== templateFilter) return false
      if (!q) return true
      if (e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)) return true
      return e.fields.some(
        (f) => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q),
      )
    })
  }, [model.entities, search, templateFilter])

  const selected = useMemo(
    () => (selectedId ? (model.entities.find((e) => e.id === selectedId) ?? null) : null),
    [model.entities, selectedId],
  )

  const handleNew = async () => {
    const label = (await showPrompt({ title: 'New entity', label: 'Label', placeholder: 'e.g. Grafana' }))?.trim()
    if (!label) return
    const existingIds = new Set(model.entities.map((e) => e.id))
    const id = uniqueId(slugify(label), existingIds)
    setModel((m) => addEntity(m, { id, label, fields: [] }))
    setSelectedId(id)
  }

  const handleDelete = async (id: string) => {
    const label = model.entities.find((e) => e.id === id)?.label ?? id
    const usedIn = usedInByEntity[id] ?? []
    const ok = await showConfirm({
      title: `Delete “${label}”?`,
      message: usedIn.length
        ? `It is used in ${usedIn.length} diagram(s) and will be removed from all of them.`
        : 'This removes the entity from the catalog.',
      danger: true,
    })
    if (!ok) return
    setModel((m) => deleteEntity(m, id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="entities-page">
      <div className="entities-page__subtabs">
        <button
          className={subTab === 'entities' ? 'active' : ''}
          onClick={() => setSubTab('entities')}
        >
          Entities
        </button>
        <button
          className={subTab === 'templates' ? 'active' : ''}
          onClick={() => setSubTab('templates')}
        >
          Templates
        </button>
      </div>

      {subTab === 'templates' ? (
        <div className="entities-page__templates-tab">
          <Templates model={model} setModel={setModel} />
        </div>
      ) : (
      <div className="entities-page__body">
      <div className="entities-page__table-wrap">
        <div className="entities-page__toolbar">
          <input
            className="entities-page__search"
            type="text"
            placeholder="Search label / field key / value…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
            <option value="">All templates</option>
            {model.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="entities-page__new" onClick={handleNew}>
            + New entity
          </button>
        </div>

        <div className="entities-table-scroll">
        <table className="entities-table">
          <thead>
            <tr>
              <th className="entities-table__icon-col" />
              <th>Label</th>
              <th>Template</th>
              <th>Status</th>
              <th>Fields</th>
              <th>Used in</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const tmpl = e.template ? templatesById[e.template] : undefined
              const usedIn = usedInByEntity[e.id] ?? []
              return (
                <tr
                  key={e.id}
                  className={e.id === selectedId ? 'entities-table__row selected' : 'entities-table__row'}
                  onClick={() => setSelectedId(e.id)}
                >
                  <td>
                    {e.icon ? (
                      <img className="entities-table__icon" src={`${ICON_BASE}/${e.icon}.svg`} alt="" />
                    ) : (
                      <span className="entities-table__icon entities-table__icon--placeholder">
                        {e.label.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td>{e.label}</td>
                  <td>{tmpl?.name ?? '—'}</td>
                  <td>{e.status ? <span className={`legend__dot status-${e.status}`} /> : '—'}</td>
                  <td>{e.fields.length} fields</td>
                  <td className="entities-table__usedin-cell">
                    <button
                      className="entities-table__usedin"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setUsedInOpenFor(usedInOpenFor === e.id ? null : e.id)
                      }}
                    >
                      {usedIn.length}
                    </button>
                    {usedInOpenFor === e.id && (
                      <div className="entities-table__popover" onClick={(ev) => ev.stopPropagation()}>
                        {usedIn.length === 0 ? (
                          <div className="entities-table__popover-empty">Not used in any diagram</div>
                        ) : (
                          usedIn.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => {
                                setUsedInOpenFor(null)
                                onJump(d.id)
                              }}
                            >
                              {d.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="entities-table__empty">
                  No entities found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="entities-page__detail">
        {selected ? (
          <EntityDetail
            key={selected.id}
            entity={selected}
            templates={model.templates}
            usedInCount={(usedInByEntity[selected.id] ?? []).length}
            setModel={setModel}
            onDelete={() => handleDelete(selected.id)}
          />
        ) : (
          <div className="panel detail detail--empty">
            <h4>Entity detail</h4>
            <div className="detail__hint">Select an entity from the table to edit it.</div>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  )
}

function EntityDetail({
  entity,
  templates,
  usedInCount,
  setModel,
  onDelete,
}: {
  entity: Entity
  templates: Template[]
  usedInCount: number
  setModel: React.Dispatch<React.SetStateAction<Model>>
  onDelete: () => void
}) {
  const patch = (p: Partial<Entity>) => setModel((m) => updateEntity(m, entity.id, p))
  const setFields = (fields: EntityField[]) => setModel((m) => setEntityFields(m, entity.id, fields))

  const updateField = (idx: number, p: Partial<EntityField>) => {
    setFields(entity.fields.map((f, i) => (i === idx ? { ...f, ...p } : f)))
  }
  const removeField = (idx: number) => {
    setFields(entity.fields.filter((_, i) => i !== idx))
  }
  const addField = () => {
    setFields([...entity.fields, { key: '', value: '', showOnNode: false }])
  }

  return (
    <div className="panel detail">
      <h4>Edit entity</h4>
      <div className="detail__sub">{entity.id}</div>

      <label className="detail__field">
        <span>Label</span>
        <input value={entity.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <label className="detail__field">
        <span>Icon slug</span>
        <input
          value={entity.icon ?? ''}
          placeholder="plex, sonarr, … (dashboard-icons)"
          onChange={(e) => patch({ icon: e.target.value || undefined })}
        />
      </label>
      <label className="detail__field">
        <span>Sub / port</span>
        <input
          value={entity.sub ?? ''}
          placeholder=":8080"
          onChange={(e) => patch({ sub: e.target.value || undefined })}
        />
      </label>
      <label className="detail__field">
        <span>Status</span>
        <select
          value={entity.status ?? ''}
          onChange={(e) => patch({ status: (e.target.value || undefined) as Status | undefined })}
        >
          <option value="">(none)</option>
          <option value="up">up</option>
          <option value="down">down</option>
          <option value="idle">idle</option>
        </select>
      </label>
      <label className="detail__field">
        <span>Template</span>
        <select
          value={entity.template ?? ''}
          onChange={(e) => {
            const id = e.target.value
            if (!id) {
              setModel((m) => ({
                ...m,
                entities: m.entities.map((en) => (en.id === entity.id ? { ...en, template: undefined } : en)),
              }))
              return
            }
            const tmpl = templates.find((t) => t.id === id)
            if (!tmpl) return
            setModel((m) => ({
              ...m,
              entities: m.entities.map((en) => (en.id === entity.id ? applyTemplate(en, tmpl) : en)),
            }))
          }}
        >
          <option value="">(none)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <div className="detail__fields">
        <div className="detail__fields-header">
          <span>Fields</span>
          <button className="detail__addfield" onClick={addField}>
            + field
          </button>
        </div>
        {entity.fields.map((f, i) => (
          <div className="detail__fieldrow" key={i}>
            <input placeholder="key" value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} />
            <input
              placeholder="value"
              value={f.value}
              onChange={(e) => updateField(i, { value: e.target.value })}
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
        {entity.fields.length === 0 && <div className="detail__fields-empty">No fields yet</div>}
      </div>

      <button className="insp__delete detail__delete" onClick={onDelete}>
        Delete entity{usedInCount > 0 ? ` (used in ${usedInCount})` : ''}
      </button>
    </div>
  )
}
