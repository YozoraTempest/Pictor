import { useCallback, useRef, useState } from 'react'

import type { ModelEffort } from '@vulonlok/shared'

import { effortColor, effortLabel } from './effort.js'

export interface EffortSliderProps {
  /** Levels this model accepts; `omit` is always offered ahead of them. */
  levels: readonly ModelEffort[]
  /** Current level, or `null` for "send nothing". */
  value: ModelEffort | null
  onChange: (level: ModelEffort | null) => void
}

/** How long the knob takes to settle on a notch once the pointer lets go. */
const SETTLE = '260ms cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * The reasoning level as a stepped slider.
 *
 * A native range input cannot show what the steps mean and cannot animate its own
 * fill, so the track, the notches and the knob are drawn here.
 *
 * The knob follows the pointer exactly while dragging and settles onto the nearest
 * notch on release: snapping every pixel would feel sticky, and snapping only on
 * release alone would hide what the drag is doing.
 */
export function EffortSlider({ levels, value, onChange }: EffortSliderProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)
  /** Pointer position while dragging, as a 0–1 fraction of the track. */
  const [drag, setDrag] = useState<number | null>(null)
  // The first notch is "send nothing"; every later notch is one declared level.
  const steps = levels.length + 1
  const index = value === null ? 0 : levels.indexOf(value) + 1
  const ratio = steps <= 1 ? 0 : index / (steps - 1)
  const shown = drag ?? ratio
  const tone = effortColor(value)

  /** Nearest level for a 0–1 position on the track. */
  const levelAt = useCallback(
    (position: number): ModelEffort | null => {
      if (steps <= 1) return null
      const at = Math.round(Math.min(1, Math.max(0, position)) * (steps - 1))
      return at === 0 ? null : (levels[at - 1] ?? null)
    },
    [levels, steps],
  )

  const follow = useCallback(
    (clientX: number): void => {
      const track = trackRef.current
      if (track === null) return
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      const position = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      setDrag(position)
      const next = levelAt(position)
      if (next !== value) onChange(next)
    },
    [levelAt, onChange, value],
  )

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="推理强度"
      aria-valuemin={0}
      aria-valuemax={levels.length}
      aria-valuenow={index}
      aria-valuetext={effortLabel(value)}
      onPointerDown={(event) => {
        event.preventDefault()
        // A drag must leave the control focused, or the arrow keys stop working the
        // moment someone touches the track.
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        follow(event.clientX)
      }}
      onPointerMove={(event) => {
        if (drag === null) return
        follow(event.clientX)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        // Clearing the drag hands the knob back to the level, so it glides the last
        // few pixels onto the notch instead of jumping there.
        setDrag(null)
      }}
      onPointerCancel={() => {
        setDrag(null)
      }}
      onKeyDown={(event) => {
        const step = (delta: number): void => {
          event.preventDefault()
          const at = Math.min(steps - 1, Math.max(0, index + delta))
          onChange(at === 0 ? null : (levels[at - 1] ?? null))
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') step(1)
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') step(-1)
        if (event.key === 'Home') {
          event.preventDefault()
          onChange(null)
        }
        if (event.key === 'End') {
          event.preventDefault()
          onChange(levels[levels.length - 1] ?? null)
        }
      }}
      // The hit area is much taller than the track, so the row is easy to grab
      // without making the line itself heavy.
      className="group relative -mx-1 flex h-7 cursor-pointer touch-none items-center px-1 outline-none"
    >
      <div className="relative h-2.5 w-full rounded-full bg-border-strong/50">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${String(shown * 100)}%`,
            background: tone,
            // Following the pointer must not lag behind it; a settled value glides.
            transition: drag === null ? `width ${SETTLE}` : 'none',
          }}
        />
        {Array.from({ length: steps }, (_, step) => {
          const filled = step / (steps - 1) <= shown
          return (
            <span
              key={step}
              className="pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${String((step / (steps - 1)) * 100)}%`,
                background: filled ? 'rgb(0 0 0 / 0.3)' : 'var(--color-faint)',
                opacity: filled ? 0.45 : 0.8,
                transition: `background ${SETTLE}, opacity ${SETTLE}`,
              }}
            />
          )
        })}
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white group-hover:scale-110 group-active:scale-95"
          style={{
            left: `${String(shown * 100)}%`,
            boxShadow:
              drag === null
                ? `0 0 0 3px color-mix(in srgb, ${tone} 16%, transparent), 0 1px 3px rgb(0 0 0 / 0.45)`
                : `0 0 0 5px color-mix(in srgb, ${tone} 26%, transparent), 0 1px 3px rgb(0 0 0 / 0.5)`,
            transition:
              drag === null
                ? `left ${SETTLE}, transform 160ms ease, box-shadow ${SETTLE}`
                : 'transform 120ms ease, box-shadow 120ms ease',
          }}
        />
      </div>
    </div>
  )
}
