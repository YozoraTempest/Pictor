import { Minimize2 } from 'lucide-react'
import { useState } from 'react'

import type { ChatNotice } from '@vulonlok/shared'

import { cn } from '../../lib/cn.js'

/**
 * One thing the runtime did to the transcript, as a divider.
 *
 * Context compaction is the reason this exists: the newer turns replace older ones with
 * a summary, and a transcript that simply got shorter would read as data loss. The row
 * says what happened, how much it removed, and — on request — the summary that now
 * stands in place of those turns.
 */
export function NoticeRow({ notice }: { notice: ChatNotice }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const saved =
    notice.savedTokens === null ? null : `${String(Math.round(notice.savedTokens / 1000))}k tokens`
  const expandable = notice.summary.trim().length > 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-2xs text-faint transition-colors duration-150',
            expandable && 'hover:border-border-strong hover:text-muted',
          )}
        >
          <Minimize2 className="size-3" aria-hidden />
          <span>上下文已压缩</span>
          {saved !== null && <span className="text-muted">省下 {saved}</span>}
          {expandable && <span className="text-faint">{open ? '收起摘要' : '查看摘要'}</span>}
        </button>
        <span className="h-px flex-1 bg-border" />
      </div>

      {open && expandable && (
        <div className="selectable rounded-md border border-border bg-surface/40 px-3 py-2 text-2xs leading-relaxed whitespace-pre-wrap text-muted">
          {notice.summary}
        </div>
      )}
    </div>
  )
}
