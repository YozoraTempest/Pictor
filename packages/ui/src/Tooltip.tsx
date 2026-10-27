import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from './cn.js'

export interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Which edge of the anchor the bubble is aligned to. Use `end` near the right edge. */
  align?: 'center' | 'start' | 'end'
  className?: string
}

/** Gap between the anchor and the bubble, and the smallest distance to the window edge. */
const GAP = 6
const EDGE = 8

interface Placement {
  top: number
  left: number
}

/**
 * A label shown beside a control on hover or focus.
 *
 * The bubble is portalled and positioned `fixed`, because a tooltip is the one
 * popover that is almost always inside something that clips: a card with
 * `overflow-hidden`, a scrolling pane, or a dialog. Rendering it in place meant it
 * was cut off by the nearest such ancestor and, inside a dialog, sat under the
 * overlay. Portalling also lets it flip when the anchor is near an edge, so the
 * bubble is always fully on screen.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  align = 'center',
  className,
}: TooltipProps): React.JSX.Element {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const bubbleRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const bubble = bubbleRef.current
    if (anchor === null || bubble === null) return

    const rect = anchor.getBoundingClientRect()
    const width = bubble.offsetWidth
    const height = bubble.offsetHeight

    // Horizontal sides sit beside the anchor, vertically centred on it; `align`
    // only has meaning for top and bottom.
    if (side === 'left' || side === 'right') {
      const beside = side === 'left' ? rect.left - width - GAP : rect.right + GAP
      const left = Math.min(
        Math.max(EDGE, beside),
        Math.max(EDGE, window.innerWidth - width - EDGE),
      )
      const centre = rect.top + rect.height / 2 - height / 2
      const top = Math.min(
        Math.max(EDGE, centre),
        Math.max(EDGE, window.innerHeight - height - EDGE),
      )
      setPlacement({ top, left })
      return
    }

    const preferred =
      align === 'start'
        ? rect.left
        : align === 'end'
          ? rect.right - width
          : rect.left + rect.width / 2 - width / 2

    // Keep the bubble inside the window: an anchor on the right edge would
    // otherwise push half of it off screen.
    const left = Math.min(
      Math.max(EDGE, preferred),
      Math.max(EDGE, window.innerWidth - width - EDGE),
    )

    const above = rect.top - height - GAP
    const below = rect.bottom + GAP
    const top =
      side === 'top'
        ? above < EDGE
          ? below
          : above
        : below + height > window.innerHeight - EDGE
          ? above
          : below

    setPlacement({ top, left })
  }, [align, side])

  // Measured before paint so the bubble never shows at the previous anchor.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    // The bubble is pinned to the viewport, so it has to follow the anchor when
    // the pane behind it scrolls or the window resizes.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <span
      ref={anchorRef}
      className={cn('inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          data-side={side}
          data-align={align}
          style={placement === null ? undefined : { top: placement.top, left: placement.left }}
          className={cn(
            'pointer-events-none fixed z-[60] whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow transition-opacity duration-150',
            placement === null && 'top-0 left-0',
            open ? 'opacity-100' : 'opacity-0',
          )}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  )
}
