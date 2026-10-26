import { ArrowLeft, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { ViewBlock, ViewSpec } from '../../../../shared/bridge.js'

import { Badge, Banner, IconButton, Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { Markdown } from '../chat/Markdown.js'

/**
 * The renderer's half of a plugin view: it draws a description, not plugin code.
 *
 * A view arrives as validated blocks — the renderer owns every component here, so opening
 * a panel cannot load a plugin's React into the window, and a block this build does not
 * know was already refused in the main process rather than dropped here.
 *
 * Refresh is a button, not a timer. A view that polls on its own would keep waking a
 * process nobody is watching; a view that needs freshness can say so in its `note`, and a
 * reader who wants it now asks once.
 */
export function PluginViewPanel({
  view,
  title,
  sessionId,
  onBack,
  onClose,
}: {
  /** The `views` contribution id this panel renders. */
  view: string
  title: string
  sessionId: string | null
  /** Returns the column to its list of panels. */
  onBack: () => void
  /** Collapses the column. */
  onClose: () => void
}): React.JSX.Element {
  const [spec, setSpec] = useState<ViewSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setBusy(true)
    setError(null)
    void window.pictor
      .renderPluginView(view, sessionId)
      .then((next) => {
        if (!alive) return
        setSpec(next)
        setBusy(false)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        // The old content is dropped with the failure: what the plugin said a moment ago
        // is not what it says now, and leaving it up would present a stale answer as the
        // current one.
        setSpec(null)
        setError(reason instanceof Error ? reason.message : String(reason))
        setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [view, sessionId, nonce])

  const refresh = useCallback(() => {
    setNonce((current) => current + 1)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-2 pl-1.5">
        <IconButton label="返回面板列表" className="size-7" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold tracking-wider text-faint uppercase">
          {title}
        </span>
        <IconButton label="刷新" className="size-7" disabled={busy} onClick={refresh}>
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
        </IconButton>
        <IconButton label="收起面板" className="size-7" onClick={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error !== null && <Banner tone="error">{error}</Banner>}

        {error === null && spec === null && (
          <div className="flex items-center gap-2 text-2xs text-faint">
            <Spinner className="size-3.5" />
            读取中
          </div>
        )}

        {spec !== null && (
          <div className="flex flex-col gap-2.5">
            {spec.blocks.length === 0 ? (
              <p className="text-2xs leading-relaxed text-faint">这个视图没有内容。</p>
            ) : (
              spec.blocks.map((block, index) => (
                // Blocks are positional: two identical paragraphs are two blocks.
                <Block key={String(index)} block={block} />
              ))
            )}

            {spec.note !== undefined && (
              <p className="mt-1 border-t border-border pt-2 text-2xs leading-relaxed text-faint">
                {spec.note}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** One block. The vocabulary is closed: every case here is one the SDK validates. */
function Block({ block }: { block: ViewBlock }): React.JSX.Element {
  switch (block.kind) {
    case 'heading':
      return <h3 className="text-xs font-semibold text-text">{block.text}</h3>
    case 'text':
      return <p className="text-2xs leading-relaxed whitespace-pre-wrap text-muted">{block.text}</p>
    case 'markdown':
      // Same renderer as the transcript, at the panel's own density.
      return <Markdown text={block.text} className="text-2xs text-muted" />
    case 'code':
      return (
        // Code keeps its own line breaks; a wrapped line would read as two.
        <pre className="selectable overflow-x-auto rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-2xs leading-relaxed whitespace-pre">
          {block.text}
        </pre>
      )
    case 'list':
      return block.ordered === true ? (
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-2xs leading-relaxed text-muted">
          {block.items.map((item, index) => (
            <li key={String(index)}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-2xs leading-relaxed text-muted">
          {block.items.map((item, index) => (
            <li key={String(index)}>{item}</li>
          ))}
        </ul>
      )
    case 'keyValue':
      return (
        <dl className="flex flex-col gap-1">
          {block.rows.map((row, index) => (
            <div key={String(index)} className="flex items-baseline gap-2 text-2xs">
              <dt className="w-20 shrink-0 truncate text-faint">{row.label}</dt>
              <dd className="min-w-0 flex-1 break-words text-muted">{row.value}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th
                    key={String(index)}
                    className="border-b border-border px-2 py-1 text-left font-medium text-faint"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={String(rowIndex)}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={String(cellIndex)}
                      className="border-b border-border/60 px-2 py-1 align-top text-muted"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'badge':
      return (
        <div>
          <Badge tone={block.tone ?? 'neutral'}>{block.label}</Badge>
        </div>
      )
    case 'divider':
      return <hr className="border-border" />
  }
}
