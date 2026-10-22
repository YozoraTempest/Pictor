import { Check, ChevronDown, Folder, FolderGit2, Monitor, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Tooltip } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

export interface ProjectPickerProps {
  /** Project the conversation runs in; `null` means no project at all. */
  projectId: string | null
  onChange: (projectId: string | null) => void
}

/** Gap between the trigger and the popover, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const MIN_WIDTH = 320

/**
 * Project switch above the composer.
 *
 * The bar reads like a summary — project, 本地, working directory — and opens
 * upwards into a searchable list, because it sits at the bottom of the window.
 * It renders into a portal so the transcript's scroll container cannot clip it.
 */
export function ProjectPicker({ projectId, onChange }: ProjectPickerProps): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const addProject = useWorkspaceStore((state) => state.addProject)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Viewport coordinates once the popover has been measured. */
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const active = projects.find((project) => project.id === projectId) ?? null

  const close = useCallback((): void => {
    setOpen(false)
    setQuery('')
    setPosition(null)
  }, [])

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return

    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, MIN_WIDTH)
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - width - VIEWPORT_MARGIN,
    )
    setPosition({ left, bottom: window.innerHeight - rect.top + OFFSET, width })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) === true) return
      if (popoverRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onViewportChange = (): void => {
      place()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, close, place])

  const needle = query.trim().toLowerCase()
  const visible = [...projects]
    .filter(
      (project) =>
        needle.length === 0 ||
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle),
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  function choose(next: string | null): void {
    onChange(next)
    close()
  }

  async function createProject(): Promise<void> {
    await addProject()
    // `addProject` selects the new project, which is exactly what we want here.
    const created = useWorkspaceStore.getState().selectedProjectId
    if (created !== null) onChange(created)
    close()
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="选择项目"
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-text">
          <Folder className="size-3.5 shrink-0 text-faint" />
          <span className="truncate">{active?.name ?? '临时任务'}</span>
        </span>

        <span className="h-3.5 w-px shrink-0 bg-border" />

        <span className="flex shrink-0 items-center gap-1.5 text-muted">
          <Monitor className="size-3.5 text-faint" />
          本地
        </span>

        {active !== null && (
          <>
            <span className="h-3.5 w-px shrink-0 bg-border" />
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <FolderGit2 className="size-3.5 shrink-0 text-faint" />
              <Tooltip label={active.path} className="min-w-0">
                <span className="truncate">{active.path}</span>
              </Tooltip>
            </span>
          </>
        )}

        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="选择项目"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: position?.width ?? MIN_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex max-h-80 flex-col overflow-hidden rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Search className="size-3.5 shrink-0 text-faint" aria-hidden />
              <input
                autoFocus
                value={query}
                aria-label="搜索项目"
                placeholder="搜索项目"
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-faint"
              />
            </div>

            <div className="my-1 h-px bg-border" />

            <div className="min-h-0 flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-2 py-3 text-center text-2xs text-faint">没有匹配的项目</p>
              ) : (
                visible.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => choose(project.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                  >
                    <Folder className="size-3.5 shrink-0 text-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {project.id === projectId && (
                      <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="my-1 h-px bg-border" />

            <button
              type="button"
              onClick={() => void createProject()}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
            >
              <Plus className="size-3.5 shrink-0 text-faint" aria-hidden />
              新建项目
            </button>
            <button
              type="button"
              onClick={() => choose(null)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
            >
              <X className="size-3.5 shrink-0 text-faint" aria-hidden />
              临时任务
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
