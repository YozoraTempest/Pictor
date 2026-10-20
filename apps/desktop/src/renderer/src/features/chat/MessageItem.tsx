import { motion } from 'motion/react'
import { AlertTriangle, ChevronDown, ShieldX, Sparkles, Terminal } from 'lucide-react'
import { useState } from 'react'

import type { ChatMessage } from '@pictor/shared'

import { Badge, Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { Markdown } from './Markdown.js'

function formatTime(timestamp: number | null): string | null {
  if (timestamp === null) return null
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const transition = { duration: 0.18, ease: 'easeOut' } as const

export function MessageItem({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition}
        className="flex justify-end"
      >
        <div className="selectable max-w-2xl rounded-lg rounded-br-sm border border-border bg-surface-raised px-3.5 py-2 text-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </motion.div>
    )
  }

  if (message.role === 'tool') {
    return <ToolMessage message={message} />
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      className="flex gap-3"
    >
      <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-2xs text-faint">
          <span className="font-medium text-muted">Pictor</span>
          {message.timestamp !== null && <span>· {formatTime(message.timestamp)}</span>}
        </div>
        {message.text.length === 0 ? (
          <span className="inline-flex gap-1 py-1" aria-label="正在生成">
            <Dot delay="0ms" />
            <Dot delay="140ms" />
            <Dot delay="280ms" />
          </span>
        ) : (
          <Markdown text={message.text} />
        )}
      </div>
    </motion.article>
  )
}

function Dot({ delay }: { delay: string }): React.JSX.Element {
  return (
    <span
      className="size-1.5 animate-pulse rounded-full bg-muted"
      style={{ animationDelay: delay }}
    />
  )
}

function ToolMessage({ message }: { message: ChatMessage }): React.JSX.Element {
  const blocked = message.blocked === true
  const running = message.text.length === 0 && !blocked
  const [open, setOpen] = useState(blocked || message.isError === true || message.text.length < 600)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      className={cn(
        'overflow-hidden rounded-lg border bg-surface/60',
        blocked ? 'border-danger/40' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        {blocked ? (
          <ShieldX className="size-3.5 shrink-0 text-danger" />
        ) : (
          <Terminal className="size-3.5 shrink-0 text-faint" />
        )}
        <span className="truncate font-mono text-xs text-muted">{message.toolName ?? 'tool'}</span>
        {blocked ? (
          <Badge tone="danger">
            <ShieldX className="mr-1 size-3" />
            已拦截
          </Badge>
        ) : running ? (
          <Spinner className="size-3" />
        ) : message.isError === true ? (
          <Badge tone="danger">
            <AlertTriangle className="mr-1 size-3" />
            失败
          </Badge>
        ) : (
          <Badge tone="success">完成</Badge>
        )}
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && message.text.length > 0 && (
        <pre className="selectable max-h-64 overflow-auto border-t border-border bg-bg px-3 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted">
          {message.text}
        </pre>
      )}
    </motion.div>
  )
}
