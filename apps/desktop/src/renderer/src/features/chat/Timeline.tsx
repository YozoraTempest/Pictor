import { useState } from 'react'

import { cn } from '../../lib/cn.js'
import type { Turn } from './turns.js'

/**
 * Left-hand rail: one tick per exchange, centred in the column and growing up
 * and down from the middle.
 *
 * Clicking a tick jumps to that turn; hovering shows the prompt and the start of
 * the answer, which is how you find a conversation you half remember.
 */
export function Timeline({ turns }: { turns: Turn[] }): React.JSX.Element | null {
  const [active, setActive] = useState<string | null>(null)

  if (turns.length < 2) return null

  return (
    <nav
      aria-label="对话时间轴"
      className="relative z-10 flex w-9 shrink-0 flex-col justify-center gap-1 overflow-hidden pl-2"
    >
      {turns.map((turn) => {
        const summary = turn.answer.trim().length > 0 ? turn.answer : '（未回复）'
        const current = active === turn.id

        return (
          <button
            key={turn.id}
            type="button"
            aria-label={turn.prompt.slice(0, 20) || '对话片段'}
            onMouseEnter={() => setActive(turn.id)}
            onMouseLeave={() => setActive((id) => (id === turn.id ? null : id))}
            onClick={() => {
              document
                .getElementById(turn.id)
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }}
            className="group relative flex h-2 w-6 shrink-0 items-center"
          >
            <span
              className={cn(
                'h-px w-4 transition-colors duration-150',
                current ? 'bg-accent' : 'bg-border group-hover:bg-muted',
              )}
            />

            {current && (
              // A fixed box keeps the bubble from resizing with the content; the
              // prompt is one ellipsised line and the answer gets three.
              <span className="pointer-events-none absolute top-1/2 left-6 z-20 flex h-20 w-64 -translate-y-1/2 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-surface-raised p-2.5 text-left shadow-popover">
                <span className="truncate text-xs text-text">{turn.prompt || '（无提问）'}</span>
                <span className="line-clamp-3 text-2xs leading-relaxed text-faint">{summary}</span>
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
