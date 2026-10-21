import { useState } from 'react'

import type { Turn } from './turns.js'

/**
 * Right-hand rail: one tick per exchange.
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
      className="relative flex w-6 shrink-0 flex-col items-end gap-1 py-6 pr-1"
    >
      {turns.map((turn) => {
        const summary = turn.answer.trim().length > 0 ? turn.answer : '（未回复）'

        return (
          <button
            key={turn.id}
            type="button"
            aria-label={turn.prompt.slice(0, 20) || '对话片段'}
            onMouseEnter={() => setActive(turn.id)}
            onMouseLeave={() => setActive((current) => (current === turn.id ? null : current))}
            onClick={() => {
              document
                .getElementById(turn.id)
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }}
            className="group relative flex h-2 w-4 shrink-0 items-center justify-end"
          >
            <span
              className={`h-px w-3 transition-colors duration-150 ${
                active === turn.id ? 'bg-accent' : 'bg-border group-hover:bg-muted'
              }`}
            />

            {active === turn.id && (
              <span className="pointer-events-none absolute top-1/2 right-5 z-20 w-64 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-2.5 text-left shadow-popover">
                <span className="line-clamp-2 block text-xs text-text">
                  {turn.prompt || '（无提问）'}
                </span>
                <span className="mt-1 line-clamp-3 block text-2xs leading-relaxed text-faint">
                  {summary}
                </span>
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
