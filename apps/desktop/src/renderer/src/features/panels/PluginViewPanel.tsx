import { ArrowLeft, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { ViewRender } from '../../../../shared/bridge.js'

import { Banner, IconButton, Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { FrameView } from './FrameView.js'
import { ViewContent } from './ViewContent.js'

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
  const [render, setRender] = useState<ViewRender | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  /** The action in flight, so its own button shows it and the others stay usable. */
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setBusy(true)
    setError(null)
    void window.pictor
      .renderPluginView(view, sessionId)
      .then((next) => {
        if (!alive) return
        setRender(next)
        setBusy(false)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        // The old content is dropped with the failure: what the plugin said a moment ago
        // is not what it says now, and leaving it up would present a stale answer as the
        // current one.
        setRender(null)
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

  /**
   * A button press.
   *
   * The answer is either a new description — which replaces what is drawn — or nothing,
   * in which case the panel deliberately keeps what it has: a press that changed nothing
   * visible should not blank the view to prove it was heard.
   */
  const act = useCallback(
    (action: string, value: string | undefined) => {
      setPending(action)
      void window.pictor
        .actPluginView(view, action, value, sessionId)
        .then((next) => {
          if (next !== null) setRender({ kind: 'blocks', spec: next })
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => setPending(null))
    },
    [view, sessionId],
  )

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

      {/*
        Blocks scroll; a frame does not. A padded, scrolling box around an iframe would
        make it taller than the column and leave the frame's own coordinates floating,
        so the same element changes shape with the payload.
      */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          render?.kind === 'frame' ? 'min-h-0' : 'gap-2 overflow-y-auto p-3',
        )}
      >
        {error !== null && <Banner tone="error">{error}</Banner>}

        {error === null && render === null && (
          <div className="flex items-center gap-2 text-2xs text-faint">
            <Spinner className="size-3.5" />
            读取中
          </div>
        )}

        {render?.kind === 'blocks' && (
          <ViewContent spec={render.spec} onAction={act} busy={pending} />
        )}

        {/*
          A frame fills the column and scrolls inside itself. `nonce` is part of its key so
          the refresh button reloads the bundle — there is nothing here to re-read, and a
          frame that kept its old state while claiming to be refreshed would be lying.
        */}
        {render?.kind === 'frame' && (
          <FrameView
            key={`${render.url}#${String(nonce)}`}
            url={render.url}
            title={render.title}
            view={view}
            sessionId={sessionId}
            className="min-h-0 flex-1"
            onError={setError}
          />
        )}
      </div>
    </div>
  )
}
