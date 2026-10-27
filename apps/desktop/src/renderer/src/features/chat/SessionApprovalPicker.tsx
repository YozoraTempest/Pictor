import { Check, ChevronDown, ShieldQuestion, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { ApprovalMode } from '@vulonlok/shared'

import { cn } from '../../lib/cn.js'
import { useKernelCapabilities } from '../kernels/capabilities.js'
import { useChatStore } from './chat-store.js'

/**
 * The two answers this switch has, and what each one means.
 *
 * Neither is a sandbox: Pi runs with the account's own permissions, so nothing here
 * stops a call. What it decides is when a call pauses for a person — which is the
 * only lever a kernel without a sandbox has.
 */
const MODES: {
  id: ApprovalMode
  label: string
  hint: string
  icon: typeof ShieldQuestion
}[] = [
  {
    id: 'never',
    label: '不问',
    hint: '工具调用直接执行；只有拒绝规则会拦下',
    icon: ShieldOff,
  },
  {
    id: 'mutating',
    label: '改动时问',
    hint: '会改动文件、运行命令或访问外部世界的调用先问你',
    icon: ShieldQuestion,
  },
]

/** Gap between the trigger and the menu, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const MENU_WIDTH = 240

/**
 * When this conversation's tool calls wait for a person.
 *
 * The mode belongs to the kernel that hands Pictor the decision — Pi — because a
 * kernel with its own sandbox already answers this itself, and a second switch for it
 * would promise a control that does nothing. The choice is read back after a change
 * for the same reason the sandbox switch is: a kernel that ignored it must not leave
 * the button claiming something else.
 */
export function SessionApprovalPicker(): React.JSX.Element | null {
  const sessionId = useChatStore((state) => state.current.sessionId)
  const canSwitch = useKernelCapabilities(sessionId.length === 0 ? null : sessionId).approval
  const [mode, setMode] = useState<ApprovalMode | null>(null)
  /** Tools this conversation already answers "yes" for, so they can be taken back. */
  const [grants, setGrants] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // A kernel that decides for itself never answers this, so asking would only fill the
    // main process log with a question it cannot take.
    if (sessionId.length === 0 || !canSwitch) {
      setMode(null)
      return
    }
    let alive = true
    void window.pictor
      .kernelApproval(sessionId)
      .then((next) => {
        if (alive) setMode(next)
      })
      .catch(() => {
        // A kernel that does not hand this over has nothing to show, and guessing a
        // mode would claim a policy that is not in effect.
        if (alive) setMode(null)
      })
    return () => {
      alive = false
    }
  }, [sessionId, canSwitch])

  // Read on open as well: the approval card can add an allow between two openings.
  useEffect(() => {
    if (!open || sessionId.length === 0) return
    let alive = true
    void window.pictor
      .kernelGrants(sessionId)
      .then((next) => {
        if (alive) setGrants(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [open, sessionId])

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
        window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
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
      if (menuRef.current?.contains(target) === true) return
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

  if (sessionId.length === 0 || mode === null || !canSwitch) return null

  const active = MODES.find((entry) => entry.id === mode)
  if (active === undefined) return null
  const Icon = active.icon

  async function apply(next: ApprovalMode): Promise<void> {
    close()
    if (next === mode) return
    setBusy(true)
    setError(null)
    try {
      await window.pictor.selectKernelApproval(sessionId, next)
      setMode(await window.pictor.kernelApproval(sessionId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`会话审批：${active.label}`}
        disabled={busy}
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs transition-colors duration-150 hover:bg-surface-hover',
          active.id === 'mutating' ? 'text-accent' : 'text-muted',
          open && 'bg-surface-hover',
        )}
      >
        <Icon
          className={cn('size-3 shrink-0', active.id === 'mutating' ? '' : 'text-faint')}
          aria-hidden
        />
        <span className="truncate">{active.label}</span>
        <ChevronDown
          className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="会话审批"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: MENU_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex flex-col rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            {MODES.map((entry) => {
              const ModeIcon = entry.icon
              const selected = entry.id === mode
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void apply(entry.id)}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
                >
                  <ModeIcon
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      entry.id === 'mutating' ? 'text-accent' : 'text-faint',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-text">{entry.label}</span>
                    <span className="block text-2xs text-faint">{entry.hint}</span>
                  </span>
                  {selected && (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                  )}
                </button>
              )
            })}

            {grants.length > 0 && (
              <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pt-1.5">
                <span className="min-w-0 flex-1 truncate text-2xs text-faint">
                  本会话已允许：{grants.join('、')}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-sm px-1 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                  onClick={() => {
                    void window.pictor
                      .revokeKernelGrants(sessionId)
                      .then(setGrants)
                      .catch((reason: unknown) => {
                        setError(reason instanceof Error ? reason.message : String(reason))
                      })
                  }}
                >
                  撤销
                </button>
              </div>
            )}

            <p className="px-2 pt-1 pb-1 text-2xs leading-relaxed text-faint">
              Pi 按账号自己的权限运行，这个开关决定什么时候停一下问你，不限制它能做什么。
            </p>

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
