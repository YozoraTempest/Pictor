import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Dialog, Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { filterSessionsByQuery } from './grouping.js'

/**
 * Find a conversation by title or project name.
 *
 * A dialog rather than a sidebar field: the sidebar is a hierarchy the reader
 * navigates, while this is a jump — it takes the keyboard, narrows as you type,
 * and closes on the pick.
 */
export function SessionSearchDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const sessions = useWorkspaceStore((state) => state.sessions)
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const selectSession = useWorkspaceStore((state) => state.selectSession)

  const [query, setQuery] = useState('')

  // Every opening starts clean: leftover text would hide the list the reader
  // came to see.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )

  const matches = useMemo(
    () =>
      filterSessionsByQuery(sessions, projects, query).sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    [sessions, projects, query],
  )

  function pick(id: string): void {
    selectSession(id)
    onClose()
  }

  return (
    <Dialog open={open} title="搜索会话" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = matches[0]
              if (event.key === 'Enter' && first !== undefined) {
                event.preventDefault()
                pick(first.id)
              }
            }}
            placeholder="按标题或项目名搜索"
            aria-label="搜索会话"
            className="pl-8"
          />
        </div>

        {matches.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-faint">没有匹配的会话</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {matches.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => pick(session.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover',
                    session.id === selectedSessionId && 'bg-surface-hover',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-text">{session.title}</span>
                  <span className="shrink-0 text-2xs text-faint">
                    {session.archived
                      ? '已归档'
                      : session.projectId === null
                        ? '临时任务'
                        : (projectsById.get(session.projectId) ?? '')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-2xs text-faint">{matches.length} 个结果 · 回车打开第一条 · Esc 关闭</p>
      </div>
    </Dialog>
  )
}
