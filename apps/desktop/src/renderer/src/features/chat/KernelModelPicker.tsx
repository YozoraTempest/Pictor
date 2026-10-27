import { Check, ChevronDown, ImageIcon, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { KernelModel, KernelModelState } from '../../../../shared/bridge.js'
import type { ModelEffort } from '@vulonlok/shared'

import { cn } from '../../lib/cn.js'
import { EffortSlider } from './EffortSlider.js'
import { effortLabel, effortTone } from './effort.js'
import { useKernelModelSource } from '../kernels/capabilities.js'
import { useChatStore } from './chat-store.js'

/** Gap between the trigger and the popover, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const PANEL_WIDTH = 240

/**
 * The model a kernel brings itself.
 *
 * A kernel like Pi keeps its own catalogue — its own providers, its own context
 * windows, its own idea of which models take images — so Pictor cannot draw that
 * list from its own settings. What it can do is ask, show the real names, and let
 * the choice travel back as a command; anything else would be a picker that lies
 * about what the next turn will run.
 *
 * Nothing is drawn for a conversation whose kernel does not answer for its models:
 * that one uses Pictor's own list, which another control owns.
 */
export function KernelModelPicker(): React.JSX.Element | null {
  const sessionId = useChatStore((state) => state.current.sessionId)
  const source = useKernelModelSource(sessionId.length === 0 ? null : sessionId)
  const [list, setList] = useState<KernelModelState | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (source !== 'kernel' || sessionId.length === 0) {
      setList(null)
      return
    }
    let alive = true
    void window.pictor
      .kernelModels(sessionId)
      .then((next: KernelModelState) => {
        if (alive) setList(next)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setList({ models: [], activeId: null, activeEffort: null })
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [source, sessionId])

  const close = useCallback((): void => {
    setOpen(false)
    setPosition(null)
  }, [])

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return
    const rect = trigger.getBoundingClientRect()
    // The trigger sits at the right end of the row, so the panel grows leftwards
    // from that edge and stays under the control it belongs to.
    setPosition({
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, rect.right - PANEL_WIDTH),
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

  if (source !== 'kernel' || list === null) return null

  const active = list.models.find((model) => model.id === list.activeId) ?? null
  const levels = active?.efforts ?? []

  async function setEffort(level: ModelEffort | null): Promise<void> {
    setError(null)
    try {
      await window.pictor.selectKernelEffort(sessionId, level)
      setList(await window.pictor.kernelModels(sessionId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function choose(model: KernelModel): Promise<void> {
    close()
    setError(null)
    setBusy(true)
    try {
      await window.pictor.selectKernelModel(sessionId, model.id)
      // Read back rather than assume: the kernel is the authority on what it runs.
      setList(await window.pictor.kernelModels(sessionId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setOpen(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={active === null ? '选择内核模型' : `内核模型：${active.label}`}
        title={active === null ? undefined : `${active.label} · ${effortLabel(list.activeEffort)}`}
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:opacity-50',
          open && 'bg-surface-hover',
        )}
      >
        <Sparkles className="size-3 shrink-0 text-faint" aria-hidden />
        <span className="max-w-40 truncate">{active?.label ?? '选择模型'}</span>
        {levels.length > 0 && (
          <span className={cn('shrink-0', effortTone(list.activeEffort))}>
            {effortLabel(list.activeEffort)}
          </span>
        )}
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
            aria-label="选择内核模型"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: PANEL_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex max-h-96 flex-col overflow-y-auto rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            {levels.length > 0 && (
              <div className="px-2 pt-1 pb-2">
                <div className="flex items-center justify-between pb-1 text-2xs text-faint">
                  <span>推理强度</span>
                  <span className={effortTone(list.activeEffort)}>
                    {effortLabel(list.activeEffort)}
                  </span>
                </div>
                <EffortSlider
                  levels={levels}
                  value={list.activeEffort}
                  onChange={(level) => void setEffort(level)}
                />
              </div>
            )}
            {list.models.length === 0 ? (
              <p className="px-2 py-2 text-2xs leading-relaxed text-faint">
                {error ?? '这个内核没有可选的模型。'}
              </p>
            ) : (
              list.models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => void choose(model)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                >
                  <span className="min-w-0 flex-1 truncate">{model.label}</span>
                  {model.images && (
                    <ImageIcon className="size-3 shrink-0 text-faint" aria-label="支持图片" />
                  )}
                  {model.provider !== null && (
                    <span className="shrink-0 text-2xs text-faint">{model.provider}</span>
                  )}
                  {model.id === list.activeId && (
                    <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                  )}
                </button>
              ))
            )}
            {error !== null && list.models.length > 0 && (
              <p className="px-2 pt-1 pb-0.5 text-2xs text-danger">{error}</p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
