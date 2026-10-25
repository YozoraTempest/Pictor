import { Boxes, Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { KernelInfo } from '../../../../shared/bridge.js'
import { cn } from '../../lib/cn.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { useChatStore } from './chat-store.js'

/** Gap between the trigger and the popover, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const PANEL_WIDTH = 240

export interface KernelPickerProps {
  /** Called after a branch was created, so the workspace can select it. */
  onBranch?: () => void
}

/**
 * Which kernel answers the open conversation.
 *
 * A conversation belongs to the kernel that started it — its history is that
 * kernel's own log — so this does not rewrite a session in place. Picking another
 * kernel opens a branch on it instead, which is also the honest shape for the
 * research this exists for: two kernels, two branches, one comparison.
 *
 * With a single kernel installed the control is not drawn at all: a picker with
 * one option is furniture.
 */
export function KernelPicker({ onBranch }: KernelPickerProps): React.JSX.Element | null {
  const [kernels, setKernels] = useState<KernelInfo[] | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const sessionId = useChatStore((state) => state.current.sessionId)
  // The kernel belongs to the conversation, which the workspace owns.
  const sessionKernel = useWorkspaceStore(
    (state) => state.sessions.find((entry) => entry.id === sessionId)?.kernelId ?? null,
  )
  const branchToKernel = useWorkspaceStore((state) => state.branchToKernel)

  useEffect(() => {
    let alive = true
    void window.pictor
      .listKernels()
      .then((next) => {
        if (alive) setKernels(next)
      })
      .catch(() => {
        if (alive) setKernels([])
      })
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
    setPosition({
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left),
        window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
      ),
      bottom: window.innerHeight - rect.top + OFFSET,
    })
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
      if (panelRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  // One kernel is not a choice; nothing to draw.
  if (kernels === null || kernels.length < 2) return null

  const active =
    kernels.find((kernel) => kernel.id === sessionKernel) ??
    kernels.find((kernel) => kernel.default) ??
    kernels[0]
  if (active === undefined) return null

  async function branchTo(kernel: KernelInfo): Promise<void> {
    close()
    if (kernel.id === active?.id || !kernel.available) return
    await branchToKernel(kernel.id, kernel.label)
    onBranch?.()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`内核：${active.label}`}
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text',
          open && 'bg-surface-hover',
        )}
      >
        <Boxes className="size-3 shrink-0 text-faint" aria-hidden />
        <span className="truncate">{active.label}</span>
        <ChevronDown
          className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="选择内核"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: PANEL_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex flex-col rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            <p className="px-2 pt-1 pb-0.5 text-2xs text-faint">
              换内核会开一条新分支，原会话留在原内核上
            </p>
            {kernels.map((kernel) => (
              <button
                key={kernel.id}
                type="button"
                disabled={!kernel.available}
                onClick={() => void branchTo(kernel)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate">{kernel.label}</span>
                {!kernel.available && <span className="shrink-0 text-2xs text-faint">未安装</span>}
                {kernel.id === active.id && (
                  <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
