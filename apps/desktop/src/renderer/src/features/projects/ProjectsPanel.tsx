import { ChevronDown, ChevronRight, FolderGit2, MoreHorizontal, Plus, X } from 'lucide-react'
import { useState } from 'react'

import { useUiStore } from '../../app/ui-store.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { IconButton } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

/** Projects block, rendered inside the sidebar's single scrolling list. */
export function ProjectsPanel(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const busy = useWorkspaceStore((state) => state.busy)
  const selectProject = useWorkspaceStore((state) => state.selectProject)
  const addProject = useWorkspaceStore((state) => state.addProject)
  const removeProject = useWorkspaceStore((state) => state.removeProject)
  const setView = useUiStore((state) => state.setView)

  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div className="mt-1 border-t border-border pt-1">
      <div className="flex items-center gap-0.5 px-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-surface-hover"
        >
          <Chevron className="size-3 shrink-0 text-faint" />
          <span className="truncate text-2xs font-semibold tracking-wider text-faint uppercase">
            项目
          </span>
          <span className="ml-auto shrink-0 pr-1 text-2xs text-faint">{projects.length}</span>
        </button>

        <IconButton label="项目管理" className="size-6" onClick={() => setView('settings')}>
          <MoreHorizontal className="size-3.5" />
        </IconButton>
        <IconButton
          label="添加项目"
          className="size-6"
          disabled={busy}
          onClick={() => void addProject()}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </div>

      {!collapsed && (
        <div className="px-0.5">
          {projects.length === 0 ? (
            <button
              type="button"
              onClick={() => void addProject()}
              className="w-full rounded-md px-2 py-1.5 text-left text-2xs text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text"
            >
              添加本地目录作为项目
            </button>
          ) : (
            <ul className="flex flex-col gap-px">
              {projects.map((project) => {
                const active = project.id === selectedProjectId
                return (
                  <li key={project.id} className="group/row relative">
                    <button
                      type="button"
                      onClick={() => selectProject(project.id)}
                      title={project.path}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md py-1.5 pr-7 pl-2 text-left text-xs transition-colors duration-150',
                        active
                          ? 'bg-surface-raised text-text'
                          : 'text-muted hover:bg-surface-hover hover:text-text',
                      )}
                    >
                      <FolderGit2
                        className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')}
                      />
                      <span className="truncate">{project.name}</span>
                    </button>

                    <IconButton
                      label="移除项目"
                      className="absolute top-0.5 right-0.5 size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                      disabled={busy}
                      onClick={() => void removeProject(project.id)}
                    >
                      <X className="size-3" />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
