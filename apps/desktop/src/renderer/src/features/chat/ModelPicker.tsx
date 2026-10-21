import { Check, ChevronDown, Cpu } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelSettings } from '@pictor/shared'

import { cn } from '../../lib/cn.js'

export interface ModelPickerProps {
  /** Called after the host accepted the switch, so the chat can be reopened. */
  onChanged?: () => void
}

/** Gap between the trigger and the popover, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const MIN_WIDTH = 260

function modelLabel(id: string, name: string | null): string {
  return name !== null && name.length > 0 ? name : id
}

/**
 * Active-model switch in the composer's footer.
 *
 * The model is a single host setting rather than per-session state, so the list
 * comes from the model profile and a change applies to the next opened chat —
 * the caller reopens the current one to make the switch take effect immediately.
 */
export function ModelPicker({ onChanged }: ModelPickerProps): React.JSX.Element | null {
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void window.pictor
      .getModelSettings()
      .then((next) => {
        if (alive) setSettings(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const close = useCallback((): void => {
    setOpen(false)
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

  // Nothing to choose from means no configured profile: stay out of the way.
  if (settings === null || settings.models.length === 0) return null

  const active = settings.models.find((model) => model.id === settings.modelId) ?? null
  const activeLabel = active === null ? settings.modelId : modelLabel(active.id, active.name)

  async function choose(modelId: string): Promise<void> {
    close()
    setError(null)
    try {
      const next = await window.pictor.selectModel(modelId)
      setSettings(next)
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="选择模型"
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      >
        <Cpu className="size-3 shrink-0 text-faint" aria-hidden />
        <span className="truncate">{activeLabel}</span>
        <ChevronDown
          className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="选择模型"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: position?.width ?? MIN_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex max-h-72 flex-col overflow-hidden rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            <p className="px-2 py-1 text-2xs text-faint">{settings.providerName || '当前端点'}</p>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {settings.models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => void choose(model.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{modelLabel(model.id, model.name)}</span>
                    <span className="block truncate text-2xs text-faint">{model.id}</span>
                  </span>
                  {model.id === settings.modelId && (
                    <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                  )}
                </button>
              ))}
            </div>

            {error !== null && (
              <p className="px-2 py-1 text-2xs text-danger" role="alert">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
