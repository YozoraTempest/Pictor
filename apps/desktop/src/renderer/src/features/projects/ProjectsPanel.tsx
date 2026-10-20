import { FolderGit2, Plus, X } from 'lucide-react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { IconButton } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

export function ProjectsPanel(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const busy = useWorkspaceStore((state) => state.busy)
  const selectProject = useWorkspaceStore((state) => state.selectProject)
  const addProject = useWorkspaceStore((state) => state.addProject)
  const removeProject = useWorkspaceStore((state) => state.removeProject)

  return (
    <section className="flex max-h-56 shrink-0 flex-col border-t border-border">
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <h2 className="text-2xs font-semibold tracking-wider text-faint uppercase">项目</h2>
        <IconButton
          label="添加项目"
          className="size-6"
          disabled={busy}
          onClick={() => void addProject()}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
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
    </section>
  )
}
