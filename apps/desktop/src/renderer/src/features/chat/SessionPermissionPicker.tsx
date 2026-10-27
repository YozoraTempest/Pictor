import { Check, ChevronDown, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { PermissionMode } from '../../../../shared/bridge.js'
import { Button, Dialog } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { useKernelCapabilities } from '../kernels/capabilities.js'
import { useChatStore } from './chat-store.js'

/** The three modes the runtime ships, in the order it ranks them. */
const MODES: { id: PermissionMode; label: string; hint: string; icon: typeof Shield }[] = [
  {
    id: 'read-only',
    label: '只读',
    hint: '能读文件与检索，不能写、不能起进程',
    icon: Shield,
  },
  {
    id: 'workspace-write',
    label: '工作区可写',
    hint: '写入限制在当前项目目录内，越界需要审批',
    icon: ShieldCheck,
  },
  {
    id: 'danger-full-access',
    label: '完全访问',
    hint: '不限制写入范围，同时关闭逐次审批',
    icon: ShieldAlert,
  },
]

function modeOf(value: string | null): (typeof MODES)[number] | null {
  return MODES.find((mode) => mode.id === value) ?? null
}

/** Gap between the trigger and the menu, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const MENU_WIDTH = 240

/**
 * Sandbox switch for the open conversation.
 *
 * The runtime keeps one permission per session, folded from the preset it was
 * opened with and any later switch, so this is deliberately separate from the
 * default in settings: widening here must not widen every other conversation.
 * The switch runs the runtime's own `/permission` command, which is not a prompt
 * — nothing reaches the model and a turn in flight keeps streaming — and the
 * value is read back afterwards, because a runtime that ignored the command must
 * not leave the button claiming a mode that is not in effect.
 */
export function SessionPermissionPicker(): React.JSX.Element | null {
  const sessionId = useChatStore((state) => state.current.sessionId)
  // A kernel that runs with the sandbox its own settings chose has nothing to
  // switch here; the button would only fail when pressed.
  const canSwitch = useKernelCapabilities(sessionId.length === 0 ? null : sessionId).permission
  const [current, setCurrent] = useState<PermissionMode | null>(null)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<PermissionMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // The answer belongs to a conversation, so switching conversations drops it: a button
    // that kept the previous one's mode would claim, for as long as the read takes, that
    // this new conversation is sandboxed the way the old one was.
    setCurrent(null)
    if (sessionId.length === 0) return
    let alive = true
    void window.pictor
      .getSessionPermission(sessionId)
      .then(async (mode) => {
        if (!alive) return
        if (mode !== null) {
          setCurrent(mode)
          return
        }
        // A conversation that predates the permission service has no recorded
        // value; the default is the closest true answer, and switching it once
        // gives the conversation a value of its own.
        const status = await window.pictor.harnessStatus().catch(() => null)
        if (!alive) return
        setCurrent(status?.permissionMode ?? null)
      })
      .catch(() => {
        // A runtime that is not up yet has no value to report; the control stays
        // hidden rather than guessing a mode.
        if (alive) setCurrent(null)
      })
    return () => {
      alive = false
    }
  }, [sessionId])

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

  if (sessionId.length === 0 || current === null || !canSwitch) return null

  const active = modeOf(current)
  const Icon = active?.icon ?? Shield

  async function apply(mode: PermissionMode): Promise<void> {
    close()
    setConfirm(null)
    setBusy(true)
    setError(null)
    try {
      const next = await window.pictor.setSessionPermission(sessionId, mode)
      setCurrent(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function choose(mode: PermissionMode): void {
    if (mode === current) {
      close()
      return
    }
    // Widening to full access cannot be undone by an approval, so it is the one
    // mode worth a second look; the others are one click.
    if (mode === 'danger-full-access') {
      setOpen(false)
      setConfirm(mode)
      return
    }
    void apply(mode)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`会话权限：${active?.label ?? current}`}
        disabled={busy}
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs transition-colors duration-150 hover:bg-surface-hover',
          current === 'danger-full-access' ? 'text-danger' : 'text-muted',
          open && 'bg-surface-hover',
        )}
      >
        <Icon
          className={cn('size-3 shrink-0', current === 'danger-full-access' ? '' : 'text-faint')}
          aria-hidden
        />
        <span className="truncate">{active?.label ?? current}</span>
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
            aria-label="会话权限"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: MENU_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex flex-col rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            {MODES.map((mode) => {
              const ModeIcon = mode.icon
              const selected = mode.id === current
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => choose(mode.id)}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
                >
                  <ModeIcon
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      mode.id === 'danger-full-access' ? 'text-danger' : 'text-faint',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-text">{mode.label}</span>
                    <span className="block text-2xs text-faint">{mode.hint}</span>
                  </span>
                  {selected && (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                  )}
                </button>
              )
            })}

            {error !== null && (
              <p className="px-2 py-1 text-2xs text-danger" role="alert">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}

      <Dialog
        open={confirm !== null}
        title="允许完全访问？"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm !== null) void apply(confirm)
              }}
            >
              改为完全访问
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          这个会话将不再限制写入范围，也不再逐次请求审批。模型可以对工作目录之外的文件执行修改。
          只在你确信任务可信、并且能自行检查结果时使用。
        </p>
      </Dialog>
    </>
  )
}
