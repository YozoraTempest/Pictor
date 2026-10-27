import { useEffect, useState } from 'react'

import type { SlotDescriptor, ViewRender } from '../../../../shared/bridge.js'
import { iconFor } from '../../lib/icons.js'
import { cn } from '../../lib/cn.js'
import { Banner, Spinner } from '../../components/ui/index.js'
import { FrameView } from '../panels/FrameView.js'
import { ViewContent } from '../panels/ViewContent.js'

/**
 * Draws whatever plugins put in one slot.
 *
 * The window owns every slot's shape and every component in it; a plugin only says where
 * it wants to sit and what the seat contains. That is the same rule as panels, applied to
 * six places instead of one — and it is why opening an app full of plugin seats still
 * cannot load a plugin's React into the window.
 *
 * Seats are read from the same list the panel column reads, so a plugin that appears in
 * one appears in the other in the same refresh; there is no second source to drift.
 */
export function SlotOutlet({
  slot,
  seats,
  sessionId,
  className,
  /**
   * How much frame a seat gets.
   *
   * `bare` is for a slot that is already a strip or a bar — the title bar, the strip under
   * the columns, a page that draws its own header. A card inside those would add height
   * the layout does not have and a border against a border.
   */
  chrome = 'inline',
  empty = null,
}: {
  slot: SlotDescriptor['slot']
  seats: readonly SlotDescriptor[]
  sessionId: string | null
  className?: string
  chrome?: 'bare' | 'inline' | 'panel'
  /** Drawn when nobody occupies the slot. Absent means the slot takes no room. */
  empty?: React.ReactNode
}): React.JSX.Element | null {
  const mine = seats.filter((seat) => seat.slot === slot)
  if (mine.length === 0) return <>{empty}</>

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      {mine.map((seat) => (
        <Seat
          key={`${seat.slot}:${seat.key ?? seat.slot}`}
          seat={seat}
          sessionId={sessionId}
          chrome={chrome}
        />
      ))}
    </div>
  )
}

/** One occupied seat: its header (when the slot has one) and the view it names. */
function Seat({
  seat,
  sessionId,
  chrome,
}: {
  seat: SlotDescriptor
  sessionId: string | null
  chrome: 'bare' | 'inline' | 'panel'
}): React.JSX.Element {
  const [render, setRender] = useState<ViewRender | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const Icon = iconFor(seat.icon)

  useEffect(() => {
    let alive = true
    setRender(null)
    setError(null)
    void window.pictor
      .renderPluginView(seat.view, sessionId)
      .then((next) => {
        if (alive) setRender(next)
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [seat.view, sessionId])

  /** A press in this seat: same channel as a panel's buttons. */
  const act = (action: string, value: string | undefined): void => {
    setPending(action)
    void window.pictor
      .actPluginView(seat.view, action, value, sessionId)
      .then((next) => {
        if (next !== null) setRender({ kind: 'blocks', spec: next })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => setPending(null))
  }

  /**
   * A frame in a seat takes the height the slot gives it: a strip gets a short box and the
   * frame scrolls inside it, because a seat that grows with its content would push the
   * conversation around whenever plugin code felt like it.
   */
  const frame = (size: string): React.JSX.Element | null =>
    render?.kind === 'frame' ? (
      <FrameView
        url={render.url}
        title={render.title}
        view={seat.view}
        sessionId={sessionId}
        className={size}
        onError={setError}
      />
    ) : null

  const body = (
    <>
      {error !== null && <Banner tone="error">{error}</Banner>}
      {error === null && render === null && (
        <div className="flex items-center gap-2 text-2xs text-faint">
          <Spinner className="size-3" />
          {seat.title}
        </div>
      )}
      {render?.kind === 'blocks' && (
        <ViewContent spec={render.spec} onAction={act} busy={pending} />
      )}
      {frame(chrome === 'panel' ? 'min-h-0 flex-1' : 'h-32')}
    </>
  )

  if (chrome === 'bare') {
    // Text blocks are paragraphs by default; inside a bar they read wrong stacked, so the
    // gap between blocks is tightened there and nowhere else.
    return <div className="flex min-w-0 flex-col gap-1 text-2xs text-muted">{body}</div>
  }

  if (chrome === 'inline') {
    return (
      // Click-through except for the controls inside it: a `button` block opts in, the card
      // around it does not. That is what keeps a floating seat from covering a control
      // that matters while still letting its own buttons be pressed.
      <div className="pointer-events-none rounded-md border border-border bg-surface px-2.5 py-2 [&_button]:pointer-events-auto">
        <div className="mb-1 flex items-center gap-1.5 text-2xs text-faint">
          <Icon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{seat.title}</span>
        </div>
        {body}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Icon className="size-3.5 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold tracking-wider text-faint uppercase">
          {seat.title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
    </div>
  )
}
