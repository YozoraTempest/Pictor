import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, IconButton, Input } from '../../components/ui/index.js'
import { Section } from './Section.js'

export function SectionsSection(): React.JSX.Element {
  const sections = useWorkspaceStore((state) => state.sections)
  const busy = useWorkspaceStore((state) => state.busy)
  const createSection = useWorkspaceStore((state) => state.createSection)
  const renameSection = useWorkspaceStore((state) => state.renameSection)
  const removeSection = useWorkspaceStore((state) => state.removeSection)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  return (
    <Section
      title="自定义分区"
      description="分区用来给会话分组，可新建、重命名或删除；删除分区不会删除会话。"
    >
      {sections.length === 0 ? (
        <p className="text-xs text-faint">还没有分区。新建后可在左栏把会话拖到分区里。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sections.map((section) => (
            <li
              key={section.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
            >
              {editingId === section.id ? (
                <>
                  <Input
                    autoFocus
                    value={editingName}
                    aria-label="分区名称"
                    className="h-7 text-xs"
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditingId(null)
                      if (event.key === 'Enter' && editingName.trim().length > 0) {
                        void renameSection(section.id, editingName.trim())
                        setEditingId(null)
                      }
                    }}
                  />
                  <IconButton
                    label="保存名称"
                    className="size-6"
                    disabled={editingName.trim().length === 0}
                    onClick={() => {
                      void renameSection(section.id, editingName.trim())
                      setEditingId(null)
                    }}
                  >
                    <Check className="size-3" />
                  </IconButton>
                  <IconButton label="取消" className="size-6" onClick={() => setEditingId(null)}>
                    <X className="size-3" />
                  </IconButton>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(section.id)
                      setEditingName(section.name)
                    }}
                    className="min-w-0 flex-1 truncate text-left text-xs text-text hover:text-accent"
                  >
                    {section.name}
                  </button>
                  <IconButton
                    label="删除分区"
                    className="size-6"
                    disabled={busy}
                    onClick={() => void removeSection(section.id)}
                  >
                    <Trash2 className="size-3" />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = draft.trim()
          if (trimmed.length === 0) return
          void createSection(trimmed)
          setDraft('')
        }}
      >
        <Input
          value={draft}
          placeholder="新分区名称"
          aria-label="新分区名称"
          className="h-8 max-w-64 text-xs"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button size="sm" variant="secondary" type="submit" disabled={draft.trim().length === 0}>
          <Plus className="size-3.5" />
          新建分区
        </Button>
      </form>
    </Section>
  )
}
