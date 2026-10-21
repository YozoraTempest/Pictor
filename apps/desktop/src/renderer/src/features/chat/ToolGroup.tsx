import { Check, ChevronDown, ShieldX, Terminal, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import type { ChatMessage } from '@pictor/shared'

import { Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { presentTool } from './tool-presenters.js'

const BODY_LIMIT = 4000

/**
 * A run of adjacent tool calls.
 *
 * The outer row summarizes the group; expanding it lists each call, and each
 * call expands again into the sections its own tool defines (`文件内容`,
 * `执行的命令`, a future diff, …). Names and targets come from the presenter
 * registry, so a new tool can describe itself without touching this file.
 */
export function ToolGroup({
  messages,
  running,
}: {
  messages: ChatMessage[]
  running: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const latest = messages.at(-1)
  const latestView = latest === undefined ? null : presentTool(latest)

  const pending = messages.some((message) => message.text === '')
  const denied = messages.some((message) => message.blocked === true)
  const failed = messages.some((message) => message.isError === true && message.blocked !== true)

  // While running the interesting thing is which tool is busy; once the group is
  // done the only useful fact is how many calls it took, so the name is dropped.
  const summary =
    pending && running
      ? `正在调用 ${latestView?.label ?? '工具'}${latestView !== null && latestView.target.length > 0 ? ` ${latestView.target}` : ''}`
      : `已运行 ${String(messages.length)} 个工具`

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface/50',
        denied || failed ? 'border-danger/40' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        {denied ? (
          <ShieldX className="size-3.5 shrink-0 text-danger" aria-label="已拦截" />
        ) : (
          <Terminal className="size-3.5 shrink-0 text-faint" aria-hidden />
        )}
        <span className="truncate text-xs text-muted">{summary}</span>

        <GroupStatus pending={pending} running={running} denied={denied} failed={failed} />

        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul className="flex flex-col border-t border-border">
          {messages.map((message) => (
            <ToolCallRow key={message.id} message={message} />
          ))}
        </ul>
      )}
    </div>
  )
}

function GroupStatus({
  pending,
  running,
  denied,
  failed,
}: {
  pending: boolean
  running: boolean
  denied: boolean
  failed: boolean
}): React.JSX.Element {
  if (denied) return <ShieldX className="size-3 shrink-0 text-danger" aria-label="已拦截" />
  if (failed) return <TriangleAlert className="size-3 shrink-0 text-danger" aria-label="含失败" />
  if (pending && running) return <Spinner className="size-3" />
  return <Check className="size-3 shrink-0 text-success" aria-label="已完成" />
}

function ToolCallRow({ message }: { message: ChatMessage }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const view = presentTool(message)

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        <span className="shrink-0 text-2xs text-muted">{view.label}</span>
        {view.target.length > 0 && (
          <span className="truncate font-mono text-2xs text-faint">{view.target}</span>
        )}

        <CallStatus message={message} />

        <ChevronDown
          className={cn(
            'ml-auto size-3 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && view.sections.length > 0 && (
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
      )}
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
