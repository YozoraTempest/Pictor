import { useEffect, useState } from 'react'

import { Tooltip } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { formatTokens } from '../../lib/format-time.js'
import { useChatStore } from './chat-store.js'

/** Ring geometry: small enough to sit in a text row, thick enough to read. */
const SIZE = 14
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * How much of the context window the last turn used.
 *
 * The number comes from the provider's own usage report rather than from counting
 * characters, and the window comes from the model entry, so both halves are facts
 * the app was told. With no window declared the ring is a plain dot and the text
 * is the raw count — a meter that guessed a denominator would be lying.
 */
export function ContextMeter(): React.JSX.Element | null {
  const usage = useChatStore((state) => state.current.usage)
  const [contextWindow, setContextWindow] = useState<number | null>(null)

  // The window belongs to the active model, which the settings page owns.
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
  }, [usage])

  if (usage === null) return null

  const used = usage.total ?? (usage.input ?? 0) + (usage.output ?? 0)
  const share =
    contextWindow === null || contextWindow <= 0 ? null : Math.min(1, used / contextWindow)
  const full = share !== null && share >= 0.9
  const detail = [
    usage.input === null ? null : `输入 ${formatTokens(usage.input)}`,
    usage.output === null ? null : `输出 ${formatTokens(usage.output)}`,
    contextWindow === null ? null : `窗口 ${formatTokens(contextWindow)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return (
    <Tooltip label={detail.length > 0 ? detail : '上下文用量'}>
      <span
        aria-label="上下文用量"
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-2xs',
          full ? 'text-danger' : 'text-faint',
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
          {share !== null && share > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${String(share * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
              transform={`rotate(-90 ${String(SIZE / 2)} ${String(SIZE / 2)})`}
              className={full ? 'stroke-danger' : 'stroke-accent'}
            />
          )}
        </svg>
        <span className="font-mono">
          {contextWindow === null
            ? formatTokens(used)
            : `${formatTokens(used)} / ${formatTokens(contextWindow)}`}
        </span>
      </span>
    </Tooltip>
  )
}
