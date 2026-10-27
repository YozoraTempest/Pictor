import { GitBranch, Sparkles, Undo2 } from 'lucide-react'

import type { ForkPoint } from '@vulonlok/shared'
import { useEffect, useState } from 'react'

import { IconButton } from '@vulonlok/ui'
import { cn } from '@vulonlok/ui/cn'
import { formatClock, formatDuration, phaseLabel, type AgentPhase } from '../../lib/format-time.js'
import { Markdown } from './Markdown.js'
import { ActivityGroup } from './ActivityGroup.js'
import { NoticeRow } from './NoticeRow.js'
import { toolLabel } from './tool-presenters.js'
import type { Turn } from './turns.js'

export interface TurnBlockProps {
  turn: Turn
  /** True while this turn is the one currently streaming. */
  live: boolean
  phase: AgentPhase
  currentTool: string | null
  /** Branch the conversation at one message, keeping it; absent when unsupported. */
  onFork?: (point: ForkPoint) => void
  /**
   * Go back to before this turn: the caller branches and files the conversation it left.
   *
   * Absent for a turn nothing precedes — "back to before the first question" is an empty
   * conversation, which is what starting a new one already is.
   */
  onRewind?: (point: ForkPoint) => void
}

/**
 * One exchange: the prompt, then everything the agent did about it.
 *
 * Reasoning, tool calls and the answer share a single agent block so the reply
 * reads as one piece of work rather than a pile of unrelated rows.
 */
export function TurnBlock({
  turn,
  live,
  phase,
  currentTool,
  onFork,
  onRewind,
}: TurnBlockProps): React.JSX.Element {
  const startedAt = turn.startedAt ?? turn.finishedAt
  const finishedAt = live ? null : turn.finishedAt
  // A notice is not a turn: it stands on its own, so an idle compaction draws no
  // agent header over it.
  const notices = turn.parts.filter((part) => part.kind === 'notice')
  const spoken = turn.parts.filter((part) => part.kind !== 'notice')
  const answered = turn.user !== null || spoken.length > 0

  return (
    <section id={turn.id} className="flex scroll-mt-4 flex-col gap-3">
      {turn.user !== null && (
        <div className="group flex items-center justify-end gap-1">
          {onRewind !== undefined && turn.before !== null && (
            <RewindButton point={turn.before} onRewind={onRewind} />
          )}
          {onFork !== undefined && turn.before !== null && (
            <ForkButton point={turn.before} label="在这一问之前分叉" onFork={onFork} />
          )}
          <div className="flex max-w-2xl flex-col items-end gap-1">
            <div className="selectable flex flex-col gap-2 rounded-lg rounded-br-sm border border-border bg-surface-raised px-3.5 py-2 text-sm whitespace-pre-wrap">
              {turn.user.images !== undefined && turn.user.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {turn.user.images.map((image, index) => (
                    <img
                      key={`${image.name ?? 'image'}-${String(index)}`}
                      src={`data:${image.mediaType};base64,${image.data}`}
                      alt={image.name ?? '附图'}
                      className="max-h-40 rounded-md border border-border object-contain"
                    />
                  ))}
                </div>
              )}
              {turn.user.text.length > 0 && turn.user.text}
            </div>
            <Timestamp timestamp={turn.user.timestamp} align="end" />
          </div>
        </div>
      )}

      {notices.map((part) => (
        <NoticeRow key={part.id} notice={part.notice} />
      ))}

      <div className={cn('group flex gap-3', !answered && 'hidden')}>
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

          {spoken.map((part) => {
            if (part.kind === 'activity') {
              return <ActivityGroup key={part.id} messages={part.messages} running={live} />
            }
            return (
              <div key={part.id} className="group/part selectable text-sm leading-relaxed">
                <Markdown text={part.text} />
                {onFork !== undefined && part.fork !== undefined && (
                  <div className="mt-1 flex justify-end">
                    <ForkButton point={part.fork} label="从这条回答分叉" onFork={onFork} />
                  </div>
                )}
              </div>
            )
          })}

          <Timestamp timestamp={turn.finishedAt ?? turn.startedAt} align="start" />
        </div>
      </div>
    </section>
  )
}

/**
 * Branch from one message.
 *
 * Only rows that carry an event boundary can be a fork point, which is why the
 * button is rendered by the parent rather than always.
 */
function ForkButton({
  point,
  label,
  onFork,
}: {
  /** Where the conversation is cut: an event boundary or a kernel entry id. */
  point: ForkPoint
  /** Two rows in one turn can both fork, so each says which one it branches. */
  label: string
  onFork: (point: ForkPoint) => void
}): React.JSX.Element {
  return (
    <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within/part:opacity-100">
      <IconButton
        label={label}
        className="size-6 text-faint hover:text-text"
        onClick={() => onFork(point)}
      >
        <GitBranch className="size-3" />
      </IconButton>
    </span>
  )
}

/**
 * Go back to before one question.
 *
 * The runtime's log is append-only, so this is a branch — but the intent differs from the
 * fork beside it: the conversation being left is filed away instead of kept side by side.
 * Two buttons rather than one menu, because the difference is what happens to the old
 * conversation and that is worth a label.
 */
function RewindButton({
  point,
  onRewind,
}: {
  point: ForkPoint
  onRewind: (point: ForkPoint) => void
}): React.JSX.Element {
  return (
    <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within/part:opacity-100">
      <IconButton
        label="回到这一问之前"
        className="size-6 text-faint hover:text-text"
        onClick={() => onRewind(point)}
      >
        <Undo2 className="size-3" />
      </IconButton>
    </span>
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
