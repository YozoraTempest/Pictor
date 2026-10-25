import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/cn.js'
import { formatTokens } from '../../lib/format-time.js'
import { useChatStore } from './chat-store.js'
import { sharePercent, usageRows, usageSummary, type UsageLevel } from './context-usage.js'

/** Ring geometry: small enough to sit in a text row, thick enough to read. */
const SIZE = 14
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Gap between the trigger and the panel, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
/** Kept level with the model popover, which sits beside it in the same row. */
const PANEL_WIDTH = 240

/** One colour per band, so the meter turns warm before it runs out. */
const RING: Record<UsageLevel, string> = {
  ok: 'stroke-accent',
  high: 'stroke-warn',
  full: 'stroke-danger',
}
const TONE: Record<UsageLevel, string> = {
  ok: 'text-muted',
  high: 'text-warn',
  full: 'text-danger',
}
const BAR: Record<UsageLevel, string> = { ok: 'bg-accent', high: 'bg-warn', full: 'bg-danger' }

/**
 * How much of the context window the last turn used, and a panel with the details.
 *
 * The number comes from the provider's own usage report rather than from counting
 * characters, and the window comes from the model entry, so both halves are facts
 * the app was told. With no window declared the ring is a plain dot and the text
 * is the raw count — a meter that guessed a denominator would be lying, and the
 * panel says which setting would fix it instead of inventing a share.
 */
export function ContextMeter(): React.JSX.Element | null {
  const usage = useChatStore((state) => state.current.usage)
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // The window belongs to the active model, which the settings page owns; a turn
  // changes the counts, and opening the panel re-reads it because the settings
  // page may have been edited in between.
  useEffect(() => {
    let alive = true
    void window.pictor
      .getModelSettings()
      .then((settings) => {
        if (!alive) return
        const entry = settings.models.find((model) => model.id === settings.modelId)
        setContextWindow(entry?.contextWindow ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [usage, open])

  // Opening a fresh conversation leaves nothing to show, so the panel closes with
  // the counts it described rather than reappearing over the next turn.
  useEffect(() => {
    if (usage === null) setOpen(false)
  }, [usage])

  const close = useCallback((): void => {
    setOpen(false)
    setPosition(null)
  }, [])

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return

    const rect = trigger.getBoundingClientRect()
    // The trigger sits at the left end of the composer's right-hand group, so the
    // panel grows rightwards from the same edge instead of reaching back over it.
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
    )
    setPosition({ left, bottom: window.innerHeight - rect.top + OFFSET })
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

  if (usage === null) return null

  const summary = usageSummary(usage, contextWindow)
  if (summary === null) return null

  const percent = sharePercent(summary.share)
  const rows = usageRows(usage, summary)
  // The trigger is the ring alone, so the count lives in the tooltip: a reader who
  // wants the numbers clicks it, and one who only wants "is it filling up" reads
  // the ring's colour.
  const label =
    summary.window === null
      ? formatTokens(summary.used)
      : `${formatTokens(summary.used)} / ${formatTokens(summary.window)}`

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="上下文用量"
        title={label}
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-150 hover:bg-surface-hover',
          open && 'bg-surface-hover',
        )}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`} aria-hidden>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-border-strong"
          />
          {summary.share !== null && summary.share > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${String(summary.share * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
              transform={`rotate(-90 ${String(SIZE / 2)} ${String(SIZE / 2)})`}
              className={RING[summary.level]}
            />
          )}
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="上下文详情"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: PANEL_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex flex-col rounded-xl border border-border bg-surface-raised p-2 shadow-popover"
          >
            <div className="flex items-baseline justify-between px-1">
              <span className="text-2xs text-faint">上下文用量</span>
              {percent !== null && (
                <span className={cn('text-2xs font-medium', TONE[summary.level])}>{percent}</span>
              )}
            </div>

            {/* The share as a bar rather than only a number: how full the window is
                is a glance, and the exact counts are the rows below. */}
            <div
              role="progressbar"
              aria-label="上下文窗口占用"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={summary.share === null ? undefined : Math.round(summary.share * 100)}
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-border"
            >
              {summary.share !== null && summary.share > 0 && (
                <div
                  className={cn('h-full rounded-full', BAR[summary.level])}
                  style={{ width: `${String(summary.share * 100)}%` }}
                />
              )}
            </div>

            <dl className="mt-1.5">
              {rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between px-1 py-0.5">
                  <dt className="text-xs text-muted">{row.label}</dt>
                  <dd className="font-mono text-xs text-text">{formatTokens(row.tokens)}</dd>
                </div>
              ))}
            </dl>

            {summary.window === null && (
              <p className="mt-1 border-t border-border px-1 pt-1.5 text-2xs leading-relaxed text-faint">
                模型没有声明上下文窗口，占比和剩余都算不出来。填上「设置 › 模型 ›
                上下文窗口」就能看到。
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
