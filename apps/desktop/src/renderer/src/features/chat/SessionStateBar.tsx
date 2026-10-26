import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Compass,
  Loader2,
  Square,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'

import { isLocalSubagent } from '@pictor/shared'

import { useKernelCapabilities } from '../kernels/capabilities.js'
import { cn } from '../../lib/cn.js'
import { Button, Spinner } from '../../components/ui/index.js'
import { useChatStore } from './chat-store.js'
import { liveJobs, todoSummary } from './session-state.js'
import { SubagentDialog } from './SubagentDialog.js'

/**
 * What the conversation is doing right now, above the composer.
 *
 * Three things share this strip because they share a lifetime: they are *current*
 * states, not rows. The transcript already records the moment the agent wrote its todo
 * list; this says what that list looks like now, whether the conversation is exploring
 * read-only, and what is still running in the background. Collapsed by default — a
 * conversation is the thing being read — and every part is absent when the kernel never
 * said anything about it, so a Pi conversation draws no empty shells.
 */
export function SessionStateBar({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const todos = useChatStore((state) => state.current.todos)
  const plan = useChatStore((state) => state.current.plan)
  const jobs = useChatStore((state) => state.current.jobs)
  const killJob = useChatStore((state) => state.killJob)
  const subagents = useChatStore((state) => state.current.subagents)
  const capabilities = useKernelCapabilities(sessionId)

  const [openTodos, setOpenTodos] = useState(false)
  const [openJobs, setOpenJobs] = useState(false)
  const [openChildren, setOpenChildren] = useState(false)
  /** The child whose transcript is on screen, if any. */
  const [reading, setReading] = useState<string | null>(null)

  const running = liveJobs(jobs)
  const summary = todos === null ? null : todoSummary(todos)
  // A state that exists but has nothing to say — plan mode that was turned off, a todo
  // list the agent emptied — must not leave an empty strip above the composer.
  const showPlan = plan !== null && (plan.active || plan.pending)
  const showTodos = summary !== null && summary.total > 0
  if (!showPlan && !showTodos && jobs.length === 0 && subagents.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {showPlan && (
          <Chip
            icon={<Compass className="size-3" aria-hidden />}
            label="计划模式 · 只读"
            {...(plan.pending ? { trailing: <Spinner className="size-3" /> } : {})}
            active={plan.active}
            title={
              plan.active ? '内核正在只读探索：它不会改文件，先给你一份计划' : '正在切换计划模式'
            }
          />
        )}

        {showTodos && summary !== null && (
          <Chip
            icon={<CheckCircle2 className="size-3" aria-hidden />}
            label={`任务 ${String(summary.done)}/${String(summary.total)}`}
            {...(summary.current === null ? {} : { note: summary.current })}
            onClick={() => setOpenTodos((current) => !current)}
            expanded={openTodos}
          />
        )}

        {subagents.length > 0 && (
          <Chip
            icon={<Bot className="size-3" aria-hidden />}
            label={`子代理 ${String(subagents.length)} 个`}
            {...(subagents[0] === undefined ? {} : { note: subagents[0].label })}
            onClick={() => setOpenChildren((current) => !current)}
            expanded={openChildren}
          />
        )}

        {jobs.length > 0 && (
          <Chip
            icon={<Terminal className="size-3" aria-hidden />}
            label={
              running.length === 0
                ? `后台任务 ${String(jobs.length)} 个 · 都已结束`
                : `后台任务 ${String(running.length)} 个运行中`
            }
            onClick={() => setOpenJobs((current) => !current)}
            expanded={openJobs}
          />
        )}
      </div>

      {openTodos && todos !== null && (
        <ul className="selectable flex flex-col gap-1 rounded-md border border-border bg-surface/40 px-3 py-2">
          {todos.map((todo) => (
            <li key={todo.content} className="flex items-start gap-1.5 text-2xs leading-relaxed">
              {todo.status === 'completed' ? (
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" aria-hidden />
              ) : todo.status === 'in_progress' ? (
                <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-accent" aria-hidden />
              ) : (
                <Circle className="mt-0.5 size-3 shrink-0 text-faint" aria-hidden />
              )}
              <span
                className={cn(
                  'min-w-0 break-words',
                  todo.status === 'completed' ? 'text-faint line-through' : 'text-muted',
                )}
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}

      {openChildren && subagents.length > 0 && (
        <ul className="selectable flex flex-col gap-1 rounded-md border border-border bg-surface/40 px-3 py-2">
          {subagents.map((child) => (
            <li key={child.id} className="flex items-start justify-between gap-2 text-2xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Bot className="size-3 shrink-0 text-faint" aria-hidden />
                  <span className="truncate text-muted">{child.label}</span>
                  <span className="shrink-0 text-faint">{child.mode}</span>
                </div>
              </div>
              {isLocalSubagent(child) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`查看 ${child.label} 的记录`}
                  onClick={() => setReading(child.id)}
                >
                  查看步骤
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {openJobs && jobs.length > 0 && (
        <ul className="selectable flex flex-col gap-1 rounded-md border border-border bg-surface/40 px-3 py-2">
          {jobs.map((job) => {
            const live = job.status === 'running' || job.status === 'stopping'
            return (
              <li key={job.id} className="flex items-start justify-between gap-2 text-2xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="size-3 shrink-0 text-faint" aria-hidden />
                    <span className="truncate text-muted">{job.label}</span>
                    <span className="shrink-0 text-faint">{job.kind}</span>
                  </div>
                  <p className="mt-0.5 text-faint">{jobStatusText(job)}</p>
                </div>
                {live && capabilities.jobs && job.status === 'running' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`停止 ${job.label}`}
                    onClick={() => void killJob(job.id)}
                  >
                    <Square className="size-3" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {reading !== null && (
        <SubagentDialog
          sessionId={sessionId}
          // The dialog is only ever opened from a row of this list.
          subagent={subagents.find((child) => child.id === reading) ?? subagents[0]!}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  )
}

/** One pill in the strip. Not every pill is pressable: the plan badge is a fact. */
function Chip({
  icon,
  label,
  note,
  trailing,
  onClick,
  expanded,
  active,
  title,
}: {
  icon: React.JSX.Element
  label: string
  note?: string
  trailing?: React.JSX.Element
  onClick?: () => void
  expanded?: boolean
  active?: boolean
  title?: string
}): React.JSX.Element {
  const content = (
    <>
      {icon}
      <span className="shrink-0">{label}</span>
      {note !== undefined && <span className="min-w-0 truncate text-faint">{note}</span>}
      {trailing}
      {onClick !== undefined && (
        <ChevronDown
          className={cn(
            'size-3 shrink-0 transition-transform duration-150',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      )}
    </>
  )

  const className = cn(
    'flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs transition-colors duration-150',
    active === true ? 'border-accent/40 text-accent' : 'border-border text-muted',
    onClick === undefined ? '' : 'hover:border-border-strong hover:text-text',
  )

  if (onClick === undefined) {
    return (
      <span className={className} {...(title === undefined ? {} : { title })}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded ?? false}
      {...(title === undefined ? {} : { title })}
      className={className}
    >
      {content}
    </button>
  )
}

/** One job's own last word, in the reader's terms. */
function jobStatusText(job: { status: string; detail: string | null }): string {
  const said = job.detail === null ? '' : ` · ${job.detail}`
  if (job.status === 'running') return '运行中'
  if (job.status === 'stopping') return '正在停止'
  if (job.status === 'completed') return `已完成${said}`
  if (job.status === 'killed') return `已停止${said}`
  return `失败${said}`
}
