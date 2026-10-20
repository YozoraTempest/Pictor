import { FolderGit2, Plus, X } from 'lucide-react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, EmptyState, IconButton } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

export function ProjectsPanel(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const busy = useWorkspaceStore((state) => state.busy)
  const selectProject = useWorkspaceStore((state) => state.selectProject)
  const addProject = useWorkspaceStore((state) => state.addProject)
  const removeProject = useWorkspaceStore((state) => state.removeProject)

  return (
    <section className="flex min-h-0 flex-col border-b border-border">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
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
          <EmptyState
            title="还没有项目"
            description="添加一个本地目录，Agent 会在其中工作。"
            action={
              <Button size="sm" variant="secondary" onClick={() => void addProject()}>
                添加项目
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {projects.map((project) => {
              const active = project.id === selectedProjectId
              return (
                <li key={project.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => selectProject(project.id)}
                    title={project.path}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150',
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
                    className="absolute top-1 right-1 size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
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
