import { Brain, Check, ChevronDown, ShieldX, Terminal, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import type { ChatMessage } from '@pictor/shared'

import { Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { ThinkingBlock } from './ThinkingBlock.js'
import { presentTool } from './tool-presenters.js'
import { groupActivityItems, type ActivityItem } from './turns.js'

const BODY_LIMIT = 4000

/**
 * Everything the agent did between two answers: its reasoning interleaved with
 * the tool calls it made.
 *
 * A single call needs no summary line — the call itself is the summary, so the
 * rows are rendered bare. From two calls on, a wrapping row appears that can
 * fold the whole trail away; the switch is animated so a run that grows a second
 * call slides into its wrapper instead of jumping.
 */
export function ActivityGroup({
  messages,
  running,
}: {
  messages: ChatMessage[]
  running: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  /** Set once the reader works the disclosure, so the auto rules stop applying. */
  const [touched, setTouched] = useState(false)
  const reduced = useReducedMotion()
  const items = groupActivityItems(messages)
  const last = items.at(-1)

  const tools = messages.filter((message) => message.role === 'tool')
  const latest = tools.at(-1)
  const latestView = latest === undefined ? null : presentTool(latest)
  const pending = tools.some((message) => message.text === '')
  const denied = tools.some((message) => message.blocked === true)
  const failed = tools.some((message) => message.isError === true && message.blocked !== true)

  // Reasoning streams in last while the model thinks; that is the moment to say
  // so instead of repeating the previous tool's name.
  const thinking = running && last?.kind === 'thinking'
  const single = tools.length === 1

  // While the model only reasons, that reasoning *is* the run. Leaving the trail
  // folded would answer a half-minute wait with a spinner the text could explain.
  useEffect(() => {
    if (touched) return
    setOpen(thinking)
  }, [thinking, touched])

  const rows = (
    <ActivityRows
      items={items}
      running={running}
      last={last}
      startOpen={single}
      prominent={single}
    />
  )

  const body = (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          className="overflow-hidden border-t border-border"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduced === true ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
        >
          {rows}
        </motion.div>
      )}
    </AnimatePresence>
  )

  // Both layouts share one frame, so a run that grows a second call keeps the
  // same shape: only the summary row is added, not a different looking block.
  const shell = cn(
    'flex flex-col overflow-hidden rounded-lg border bg-surface/50',
    denied || failed ? 'border-danger/40' : 'border-border',
  )

  if (single) {
    // Nothing to fold: show the call itself rather than a header that hides it.
    return (
      <motion.div
        initial={reduced === true ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced === true ? 0 : 0.18, ease: 'easeOut' }}
        className={shell}
      >
        {rows}
      </motion.div>
    )
  }

  const summary = (() => {
    if (running && pending && latestView !== null) {
      const target = latestView.target.length === 0 ? '' : ` ${latestView.target}`
      return `正在调用 ${latestView.label}${target}`
    }
    if (thinking) return '正在思考'
    if (tools.length === 0) return '思考'
    return `已运行 ${String(tools.length)} 个工具`
  })()

  // The group wears the mark of the tool it is showing, so a scan of the
  // transcript says what kind of work happened without expanding anything. A
  // reasoning-only trail wears the reasoning mark instead of pretending a tool
  // ran.
  const HeaderIcon = denied
    ? ShieldX
    : (latestView?.icon ?? (tools.length === 0 ? Brain : Terminal))

  return (
    <motion.div
      initial={reduced === true ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced === true ? 0 : 0.18, ease: 'easeOut' }}
      className={shell}
    >
      <button
        type="button"
        onClick={() => {
          setTouched(true)
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        <HeaderIcon
          className={cn('size-3.5 shrink-0', denied ? 'text-danger' : 'text-faint')}
          aria-hidden={denied ? undefined : true}
          {...(denied ? { 'aria-label': '已拦截' } : {})}
        />
        <span className="truncate text-xs text-muted">{summary}</span>

        <GroupStatus running={running} denied={denied} failed={failed} empty={tools.length === 0} />

        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {body}
    </motion.div>
  )
}

/**
 * The rows a group shows, shared by the single-call and the wrapped layouts.
 *
 * `prominent` matches the size of the summary row: a group with one call shows
 * that call where the summary would be, so it uses the same padding and type
 * scale and the block reads the same height as a folded group.
 */
function ActivityRows({
  items,
  running,
  last,
  startOpen,
  prominent,
}: {
  items: ActivityItem[]
  running: boolean
  last: ActivityItem | undefined
  startOpen: boolean
  prominent: boolean
}): React.JSX.Element {
  return (
    <ul className="flex flex-col">
      {items.map((item) =>
        item.kind === 'thinking' ? (
          <ThinkingBlock
            key={item.id}
            text={item.text}
            live={running && item === last}
            prominent={prominent}
          />
        ) : (
          <ToolCallRow
            key={item.message.id}
            message={item.message}
            startOpen={startOpen}
            prominent={prominent}
          />
        ),
      )}
    </ul>
  )
}

function GroupStatus({
  running,
  denied,
  failed,
  empty,
}: {
  running: boolean
  denied: boolean
  failed: boolean
  empty: boolean
}): React.JSX.Element {
  if (denied) return <ShieldX className="size-3 shrink-0 text-danger" aria-label="已拦截" />
  if (failed) return <TriangleAlert className="size-3 shrink-0 text-danger" aria-label="含失败" />
  // While the run is live the trail is still moving, whatever it holds so far.
  if (running) return <Spinner className="size-3" />
  // A finished trail with no tool calls is pure reasoning; a check mark would
  // claim work that never happened.
  if (empty) return <Brain className="size-3 shrink-0 text-faint" aria-label="仅思考" />
  return <Check className="size-3 shrink-0 text-success" aria-label="已完成" />
}

function ToolCallRow({
  message,
  startOpen = false,
  prominent = false,
}: {
  message: ChatMessage
  /** Expand on first render, used when the group holds a single call. */
  startOpen?: boolean
  /** Match the summary row's height and type scale (single-call groups). */
  prominent?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(startOpen)
  const reduced = useReducedMotion()
  const view = presentTool(message)
  const Icon = view.icon

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 px-3 text-left transition-colors duration-150 hover:bg-surface-hover',
          // A fixed height for the single-call row: it must match the summary row
          // exactly, and a tight line-height (which would clip glyphs) is not an
          // option. The content is shorter than the row, so nothing is cut.
          prominent ? 'h-7' : 'py-1',
        )}
      >
        {Icon !== undefined && (
          <Icon
            className={cn('shrink-0 text-faint', prominent ? 'size-3.5' : 'size-3')}
            aria-hidden
          />
        )}
        <span className={cn('shrink-0 text-muted', prominent ? 'text-xs' : 'text-2xs')}>
          {view.label}
        </span>
        {view.target.length > 0 && (
          <span className="truncate font-mono text-2xs text-faint">{view.target}</span>
        )}
        <CallStatus message={message} />
        <ChevronDown
          className={cn(
            'ml-auto shrink-0 text-faint transition-transform duration-150',
            prominent ? 'size-3.5' : 'size-3',
            open && 'rotate-180',
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && view.sections.length > 0 && (
          <motion.div
            key="sections"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced === true ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
          >
            <div className="flex flex-col gap-2 px-3 pb-2">
              {view.sections.map((section) => (
                <div key={section.title} className="flex flex-col gap-1">
                  <span className="text-2xs text-faint">{section.title}</span>
                  {section.format === 'diff' ? (
                    <DiffBlock body={section.body} />
                  ) : (
                    <pre className="selectable max-h-48 overflow-auto rounded-md bg-bg px-2 py-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted">
                      {clipBody(section.body)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function CallStatus({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.blocked === true) {
    return <ShieldX className="size-3 shrink-0 text-danger" aria-label="已拦截" />
  }
  if (message.text.length === 0) return <Spinner className="size-3" />
  if (message.isError === true) {
    return <TriangleAlert className="size-3 shrink-0 text-danger" aria-label="失败" />
  }
  return <Check className="size-3 shrink-0 text-success" aria-label="完成" />
}

/** Unified diff: added lines green, removed red, context muted. */
function DiffBlock({ body }: { body: string }): React.JSX.Element {
  const lines = body.split('\n')

  return (
    <pre className="selectable max-h-48 overflow-auto rounded-md bg-bg px-2 py-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap">
      {lines.map((line, index) => {
        const marker = line.charAt(0)
        const tone = marker === '+' ? 'text-success' : marker === '-' ? 'text-danger' : 'text-muted'

        return (
          <div key={`${String(index)}-${line}`} className={tone}>
            {line.length === 0 ? ' ' : line}
          </div>
        )
      })}
    </pre>
  )
}

function clipBody(body: string): string {
  return body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}…` : body
}
