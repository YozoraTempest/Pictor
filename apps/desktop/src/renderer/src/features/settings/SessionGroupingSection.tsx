import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import type { SessionGrouping } from '@pictor/shared'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, IconButton, Input, Select, Switch } from '../../components/ui/index.js'
import { Section } from './Section.js'

const MODES: Array<{ id: SessionGrouping; label: string; hint: string }> = [
  { id: 'project', label: '按项目', hint: '项目是 Agent 的主要工作区，这里只影响展示分组' },
  { id: 'section', label: '按分区', hint: '分区相当于标签，一个会话可以有多个' },
  { id: 'recent', label: '按最近', hint: '按更新时间划分为今天 / 昨天 / 最近 7 天 / 更早' },
]

export function SessionGroupingSection(): React.JSX.Element {
  const sections = useWorkspaceStore((state) => state.sections)
  const grouping = useWorkspaceStore((state) => state.grouping)
  const exclusive = useWorkspaceStore((state) => state.groupingExclusive)
  const busy = useWorkspaceStore((state) => state.busy)
  const setGrouping = useWorkspaceStore((state) => state.setGrouping)
  const setGroupingExclusive = useWorkspaceStore((state) => state.setGroupingExclusive)
  const createSection = useWorkspaceStore((state) => state.createSection)
  const renameSection = useWorkspaceStore((state) => state.renameSection)
  const removeSection = useWorkspaceStore((state) => state.removeSection)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const active = MODES.find((mode) => mode.id === grouping)

  return (
    <Section
      title="会话列表"
      description="选择分组方式；置顶会话始终排在最上面，不受分组方式影响。"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">分组方式</span>
          <Select
            value={grouping}
            onChange={(event) => void setGrouping(event.target.value as SessionGrouping)}
          >
            {MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </Select>
          {active !== undefined && <span className="text-xs text-faint">{active.hint}</span>}
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">分组互斥</span>
          <label className="flex items-center gap-2 text-xs text-muted">
            <Switch
              label="分组互斥"
              checked={exclusive}
              onChange={(value) => void setGroupingExclusive(value)}
            />
            一个会话只出现在一个分组里
          </label>
          <span className="text-xs text-faint">
            {exclusive
              ? '置顶会话只在置顶分组显示；多分区会话归入第一个分区'
              : '置顶会话同时出现在置顶和所属分组；多分区会话会出现在每个分区'}
          </span>
        </div>
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
