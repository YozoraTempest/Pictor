import { useState } from 'react'

import { cn } from '../lib/cn.js'

export interface PanelResizerProps {
  /**
   * Which edge of the layout the handle sits on: `end` for a left panel's right
   * edge, `start` for a right panel's left edge. It decides which way the hit area
   * is nudged so it straddles the border.
   */
  attach: 'end' | 'start'
  /** Position of the edge inside the positioned parent. */
  style: React.CSSProperties
  label: string
  /** Called on press, so the owner can record the starting width. */
  onStart: () => void
  /** Total horizontal travel since the press, in pixels. */
  onMove: (deltaX: number) => void
  onEnd: () => void
  /** Double-click restores the default width. */
  onReset: () => void
}

/**
 * Draggable border between two panels.
 *
 * A short rule is always faintly visible so the edge reads as draggable, and it
 * brightens and grows while hovered or dragged — the same affordance the
 * conversation panel uses, so all three columns feel alike.
 */
export function PanelResizer({
  attach,
  style,
  label,
  onStart,
  onMove,
  onEnd,
  onReset,
}: PanelResizerProps): React.JSX.Element {
  const [dragging, setDragging] = useState(false)

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const startX = event.clientX

    // Capture keeps the drag alive when the pointer leaves the handle; a synthetic
    // pointer id has no active pointer, so the throw must not abort the drag.
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // Window listeners below still drive the drag.
    }

    setDragging(true)
    onStart()

    const move = (moveEvent: PointerEvent): void => {
      onMove(moveEvent.clientX - startX)
    }

    const finish = (): void => {
      setDragging(false)
      onEnd()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
      style={style}
      className={cn(
        'group absolute top-0 bottom-0 z-20 w-4 cursor-col-resize touch-none',
        attach === 'end' ? '-translate-x-1/2' : 'translate-x-1/2',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 left-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong opacity-60 transition-all duration-150 group-hover:h-16 group-hover:opacity-100',
          dragging && 'h-16 opacity-100',
        )}
      />
    </div>
  )
}
