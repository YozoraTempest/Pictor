import { useEffect, useState } from 'react'

import type { SlotDescriptor, ViewSpec } from '../../../../shared/bridge.js'
import { iconFor } from '../../lib/icons.js'
import { cn } from '../../lib/cn.js'
import { Banner, Spinner } from '../../components/ui/index.js'
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
  const [spec, setSpec] = useState<ViewSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const Icon = iconFor(seat.icon)

  useEffect(() => {
    let alive = true
    setSpec(null)
    setError(null)
    void window.pictor
      .renderPluginView(seat.view, sessionId)
      .then((next) => {
        if (alive) setSpec(next)
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [seat.view, sessionId])

  const body = (
    <>
      {error !== null && <Banner tone="error">{error}</Banner>}
      {error === null && spec === null && (
        <div className="flex items-center gap-2 text-2xs text-faint">
          <Spinner className="size-3" />
          {seat.title}
        </div>
      )}
      {spec !== null && <ViewContent spec={spec} />}
    </>
  )

  if (chrome === 'bare') {
    // Text blocks are paragraphs by default; inside a bar they read wrong stacked, so the
    // gap between blocks is tightened there and nowhere else.
    return <div className="flex min-w-0 flex-col gap-1 text-2xs text-muted">{body}</div>
  }

  if (chrome === 'inline') {
    return (
      // Click-through, including its own box. A `views` block is display-only — there is
      // nothing here to press — so a seat never needs to take a click, and a floating one
      // must never cover a control that does.
      <div className="pointer-events-none rounded-md border border-border bg-surface px-2.5 py-2">
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
