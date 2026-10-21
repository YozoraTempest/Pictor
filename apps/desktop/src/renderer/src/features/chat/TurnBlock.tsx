import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatClock, formatDuration, phaseLabel, type AgentPhase } from '../../lib/format-time.js'
import { Markdown } from './Markdown.js'
import { ThinkingBlock } from './ThinkingBlock.js'
import { ToolGroup } from './ToolGroup.js'
import { toolLabel } from './tool-presenters.js'
import type { Turn } from './turns.js'

export interface TurnBlockProps {
  turn: Turn
  /** True while this turn is the one currently streaming. */
  live: boolean
  phase: AgentPhase
  currentTool: string | null
}

/**
 * One exchange: the prompt, then everything the agent did about it.
 *
 * Reasoning, tool calls and the answer share a single agent block so the reply
 * reads as one piece of work rather than a pile of unrelated rows.
 */
export function TurnBlock({ turn, live, phase, currentTool }: TurnBlockProps): React.JSX.Element {
  const startedAt = turn.startedAt ?? turn.finishedAt
  const finishedAt = live ? null : turn.finishedAt

  return (
    <section id={turn.id} className="flex scroll-mt-4 flex-col gap-3">
      {turn.user !== null && (
        <div className="group flex justify-end">
          <div className="flex max-w-2xl flex-col items-end gap-1">
            <div className="selectable rounded-lg rounded-br-sm border border-border bg-surface-raised px-3.5 py-2 text-sm whitespace-pre-wrap">
              {turn.user.text}
            </div>
            <Timestamp timestamp={turn.user.timestamp} align="end" />
          </div>
        </div>
      )}

      <div className="group flex gap-3">
        <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
          <Sparkles className="size-3.5" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-2xs font-medium text-muted">Pictor</span>
            {live ? (
              <span className="text-2xs text-accent">
                {phaseLabel(phase, currentTool === null ? null : toolLabel(currentTool))}
              </span>
            ) : null}
            <Duration startedAt={startedAt} finishedAt={finishedAt} live={live} />
          </div>

          {turn.parts.map((part) => {
            if (part.kind === 'thinking') {
              return <ThinkingBlock key={part.id} text={part.text} running={live} />
            }
            if (part.kind === 'tools') {
              return <ToolGroup key={part.id} messages={part.messages} running={live} />
            }
            return (
              <div key={part.id} className="selectable text-sm leading-relaxed">
                <Markdown text={part.text} />
              </div>
            )
          })}

          <Timestamp timestamp={turn.finishedAt ?? turn.startedAt} align="start" />
        </div>
      </div>
    </section>
  )
}

function Timestamp({
  timestamp,
  align,
}: {
  timestamp: number | null
  align: 'start' | 'end'
}): React.JSX.Element | null {
  const clock = formatClock(timestamp)
  if (clock === null) return null

  return (
    <span
      className={`text-2xs text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${
        align === 'end' ? 'text-right' : 'text-left'
      }`}
    >
      {clock}
    </span>
  )
}

/** Elapsed time for the turn; ticks once a second while the run is live. */
function Duration({
  startedAt,
  finishedAt,
  live,
}: {
  startedAt: number | null
  finishedAt: number | null
  live: boolean
}): React.JSX.Element | null {
  const [, tick] = useState(0)

  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => tick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [live])

  if (startedAt === null) return null
  const elapsed = (finishedAt ?? Date.now()) - startedAt

  return <span className="shrink-0 text-2xs text-faint">{formatDuration(elapsed)}</span>
}
