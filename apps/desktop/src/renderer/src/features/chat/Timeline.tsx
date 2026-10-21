import { useRef, useState } from 'react'

import { cn } from '../../lib/cn.js'
import type { Turn } from './turns.js'

interface Hovered {
  turn: Turn
  /** Vertical centre of the hovered tick, relative to the rail. */
  top: number
}

/**
 * Left-hand rail: one tick per exchange, centred in the column and growing up
 * and down from the middle.
 *
 * Clicking a tick jumps to that turn; hovering shows the prompt and the start of
 * the answer, which is how you find a conversation you half remember.
 */
export function Timeline({ turns }: { turns: Turn[] }): React.JSX.Element | null {
  const railRef = useRef<HTMLElement | null>(null)
  const [hovered, setHovered] = useState<Hovered | null>(null)

  if (turns.length < 2) return null

  function show(event: React.MouseEvent<HTMLButtonElement>, turn: Turn): void {
    const rail = railRef.current
    if (rail === null) return
    const tick = event.currentTarget.getBoundingClientRect()
    setHovered({ turn, top: tick.top + tick.height / 2 - rail.getBoundingClientRect().top })
  }

  return (
    <nav
      ref={railRef}
      aria-label="对话时间轴"
      className="relative z-10 flex w-9 shrink-0 flex-col justify-center pl-2"
    >
      {/* Ticks are clipped so a long conversation cannot spill over the transcript.
          The bubble sits outside this box: `overflow-hidden` here would cut it off
          at the rail's edge, which is why it is a sibling of the list. */}
      <div className="flex flex-col gap-1 overflow-hidden">
        {turns.map((turn) => {
          const current = hovered?.turn.id === turn.id

          return (
            <button
              key={turn.id}
              type="button"
              aria-label={turn.prompt.slice(0, 20) || '对话片段'}
              onMouseEnter={(event) => show(event, turn)}
              onMouseLeave={() =>
                setHovered((active) => (active?.turn.id === turn.id ? null : active))
              }
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
            </button>
          )
        })}
      </div>

      {hovered !== null && (
        // A fixed box keeps the bubble from resizing with the content: the prompt is
        // one ellipsised line, the answer exactly three, and the box is sized so the
        // third line is clamped rather than cut off by the edge.
        <span
          className="pointer-events-none absolute left-full z-20 ml-1 flex h-24 w-96 -translate-y-1/2 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-surface-raised p-2 text-left shadow-popover"
          style={{ top: hovered.top }}
        >
          <span className="truncate text-xs text-text">{hovered.turn.prompt || '（无提问）'}</span>
          <span className="line-clamp-3 text-2xs leading-relaxed text-faint">
            {hovered.turn.answer.trim().length > 0 ? hovered.turn.answer : '（未回复）'}
          </span>
        </span>
      )}
    </nav>
  )
}
