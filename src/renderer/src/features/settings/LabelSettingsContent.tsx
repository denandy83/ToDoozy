import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { useLabelStore, useLabelsByProject } from '../../shared/stores/labelStore'
import { useProjectStore, selectCurrentProject } from '../../shared/stores/projectStore'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import type { Label } from '../../../../shared/types'

export function LabelSettingsContent(): React.JSX.Element {
  const currentProject = useProjectStore(selectCurrentProject)
  const projectId = currentProject?.id ?? ''
  const labels = useLabelsByProject(projectId)
  const { createLabel, updateLabel, deleteLabel, filterMode, setFilterMode } = useLabelStore()
  const setSetting = useSettingsStore((s) => s.setSetting)
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8

  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name || !projectId) return
    await createLabel({ id: crypto.randomUUID(), project_id: projectId, name, color: newColor })
    setNewName('')
  }, [newName, newColor, projectId, createLabel])

  const handleStartEdit = useCallback((label: Label) => {
    setEditingId(label.id)
    setEditName(label.name)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return
    const name = editName.trim()
    if (name) {
      await updateLabel(editingId, { name })
    }
    setEditingId(null)
  }, [editingId, editName, updateLabel])

  const handleDelete = useCallback(async (id: string) => {
    await deleteLabel(id)
  }, [deleteLabel])

  return (
    <div className="flex flex-col gap-6">
      {/* Filter mode toggle */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Filter Mode
        </p>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['hide', 'blur'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setFilterMode(m)}
              className={`flex-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                filterMode === m
                  ? 'bg-accent/12 text-accent'
                  : 'text-muted hover:bg-foreground/6'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {filterMode === 'hide' ? (
          <p className="mt-1 text-[10px] text-muted">Non-matching tasks are removed from view</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{blurOpacity}%</span>
              <input
                type="range"
                min={2}
                max={40}
                value={blurOpacity}
                onChange={(e) => setSetting('label_blur_opacity', e.target.value)}
                className="flex-1 accent-accent"
              />
              <span className="text-[10px] text-muted">opacity</span>
            </div>
            <div className="flex items-center justify-center gap-6 rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-light text-foreground">Matching task</span>
              <span className="text-sm font-light text-foreground" style={{ opacity: blurOpacity / 100 }}>Non-matching task</span>
            </div>
          </div>
        )}
      </div>

      {/* Label list */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Labels
        </p>
        <div className="flex flex-col gap-1">
          {labels.map((label) => (
            <div
              key={label.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-foreground/6"
            >
              <div
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {editingId === label.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={handleSaveEdit}
                  className="flex-1 bg-transparent text-sm font-light text-foreground focus:outline-none"
                />
              ) : (
                <span className="flex-1 text-sm font-light text-foreground">{label.name}</span>
              )}
              <button
                onClick={() => handleStartEdit(label)}
                className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                title="Rename"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => handleDelete(label.id)}
                className="rounded p-0.5 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {labels.length === 0 && (
            <p className="py-2 text-sm font-light text-muted/40">No labels yet</p>
          )}
        </div>
      </div>

      {/* Add new label */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="New label name..."
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-light text-foreground placeholder:text-muted outline-none focus:border-accent"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  )
}
