import { MessageSquare, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, EmptyState, IconButton, Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { formatRelative } from '../../lib/format.js'

export function SessionsPanel(): React.JSX.Element {
  const sessions = useWorkspaceStore((state) => state.sessions)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const busy = useWorkspaceStore((state) => state.busy)
  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const deleteSession = useWorkspaceStore((state) => state.deleteSession)

  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  const visible = useMemo(
    () => sessions.filter((session) => session.projectId === selectedProjectId),
    [sessions, selectedProjectId],
  )

  function submit(): void {
    const trimmed = title.trim()
    if (trimmed.length === 0) return
    void createSession(trimmed)
    setTitle('')
    setCreating(false)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-2xs font-semibold tracking-wider text-faint uppercase">会话</h2>
        <IconButton
          label="新建会话"
          className="size-6"
          disabled={busy || selectedProjectId === null}
          onClick={() => setCreating((value) => !value)}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </header>

      {creating && (
        <form
          className="flex items-center gap-1.5 px-2 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Input
            autoFocus
            value={title}
            placeholder="会话标题"
            aria-label="会话标题"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setCreating(false)
            }}
            className="h-7 text-xs"
          />
          <Button size="sm" variant="primary" type="submit" disabled={title.trim().length === 0}>
            创建
          </Button>
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {selectedProjectId === null ? (
          <EmptyState title="先选择项目" description="会话属于某个项目。" />
        ) : visible.length === 0 ? (
          <EmptyState
            title="还没有会话"
            description="新建一个会话开始对话。"
            action={
              <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
                新建会话
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visible.map((session) => {
              const active = session.id === selectedSessionId
              return (
                <li key={session.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => selectSession(session.id)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 pr-7 text-left transition-colors duration-150',
                      active
                        ? 'bg-surface-raised text-text'
                        : 'text-muted hover:bg-surface-hover hover:text-text',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquare
                        className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')}
                      />
                      <span className="truncate text-xs">{session.title}</span>
                    </span>
                    <span className="pl-5.5 text-2xs text-faint">
                      {formatRelative(session.updatedAt)}
                    </span>
                  </button>

                  <IconButton
                    label="删除会话"
                    className="absolute top-1 right-1 size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                    disabled={busy}
                    onClick={() => void deleteSession(session.id)}
                  >
                    <X className="size-3" />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
