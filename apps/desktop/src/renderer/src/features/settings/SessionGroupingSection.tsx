import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, IconButton, Input, Switch } from '../../components/ui/index.js'
import { Section } from './Section.js'

export function SessionGroupingSection(): React.JSX.Element {
  const sections = useWorkspaceStore((state) => state.sections)
  const exclusive = useWorkspaceStore((state) => state.groupingExclusive)
  const busy = useWorkspaceStore((state) => state.busy)
  const setGroupingExclusive = useWorkspaceStore((state) => state.setGroupingExclusive)
  const createSection = useWorkspaceStore((state) => state.createSection)
  const renameSection = useWorkspaceStore((state) => state.renameSection)
  const removeSection = useWorkspaceStore((state) => state.removeSection)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  return (
    <Section
      title="会话列表"
      description="左栏按「分区 → 项目 → 会话」三层展示；置顶会话始终在最上面的置顶分区。"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">分组互斥</span>
        <label className="flex items-center gap-2 text-xs text-muted">
          <Switch
            label="分组互斥"
            checked={exclusive}
            onChange={(value) => void setGroupingExclusive(value)}
          />
          置顶会话只出现在「置顶」分区
        </label>
        <span className="text-xs text-faint">
          {exclusive
            ? '置顶会话不会重复出现在项目、最近或自定义分区里'
            : '置顶会话同时出现在「置顶」和它所属的分区/项目里'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted">分区</h3>

        {sections.length === 0 ? (
          <p className="text-xs text-faint">还没有分区。新建后可在会话菜单里归档。</p>
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
      </div>
    </Section>
  )
}
