import { MessageSquare, SquarePen, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, EmptyState, IconButton, Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

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
      <div className="px-2 pt-2 pb-1">
        {creating ? (
          <form
            className="flex items-center gap-1.5"
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
              className="h-7 text-xs"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(false)
              }}
            />
            <Button size="sm" variant="primary" type="submit" disabled={title.trim().length === 0}>
              创建
            </Button>
            <IconButton label="取消" className="size-7" onClick={() => setCreating(false)}>
              <X className="size-3.5" />
            </IconButton>
          </form>
        ) : (
          <button
            type="button"
            disabled={selectedProjectId === null || busy}
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
          >
            <SquarePen className="size-3.5 shrink-0 text-faint" />
            新聊天
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {selectedProjectId === null ? (
          <p className="px-2 py-3 text-2xs text-faint">先选择一个项目</p>
        ) : visible.length === 0 ? (
          <EmptyState title="还没有会话" description="点击上方「新聊天」开始。" />
        ) : (
          <ul className="flex flex-col gap-px">
            {visible.map((session) => {
              const active = session.id === selectedSessionId
              return (
                <li key={session.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => selectSession(session.id)}
                    title={session.title}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md py-1.5 pr-7 pl-2 text-left text-xs transition-colors duration-150',
                      active
                        ? 'bg-surface-raised text-text'
                        : 'text-muted hover:bg-surface-hover hover:text-text',
                    )}
                  >
                    <MessageSquare
                      className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')}
                    />
                    <span className="truncate">{session.title}</span>
                  </button>

                  <IconButton
                    label="删除会话"
                    className="absolute top-0.5 right-0.5 size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
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
