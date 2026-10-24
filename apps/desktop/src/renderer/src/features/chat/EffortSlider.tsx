import { useCallback, useRef, useState } from 'react'

import type { ModelEffort } from '@pictor/shared'

import { effortColor, effortLabel } from './effort.js'

export interface EffortSliderProps {
  /** Levels this model accepts; `omit` is always offered ahead of them. */
  levels: readonly ModelEffort[]
  /** Current level, or `null` for "send nothing". */
  value: ModelEffort | null
  onChange: (level: ModelEffort | null) => void
}

/**
 * The reasoning level as a stepped slider.
 *
 * A native range input cannot show what the steps mean and cannot animate its
 * own fill, so the track, the notches and the knob are drawn here. Positions are
 * percentages of the same axis, which is what makes the fill and the knob move
 * together — and why a drag never drifts from the level it reports.
 */
export function EffortSlider({ levels, value, onChange }: EffortSliderProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  // The first notch is "send nothing"; every later notch is one declared level.
  const steps = levels.length + 1
  const index = value === null ? 0 : levels.indexOf(value) + 1
  const ratio = steps <= 1 ? 0 : index / (steps - 1)
  const tone = effortColor(value)

  const levelAt = useCallback(
    (position: number): ModelEffort | null => {
      if (steps <= 1) return null
      const at = Math.round(position * (steps - 1))
      return at === 0 ? null : (levels[at - 1] ?? null)
    },
    [levels, steps],
  )

  const move = useCallback(
    (clientX: number): void => {
      const track = trackRef.current
      if (track === null) return
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      const next = levelAt((clientX - rect.left) / rect.width)
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
        setDragging(true)
        move(event.clientX)
      }}
      onPointerMove={(event) => {
        if (!dragging) return
        move(event.clientX)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
      }}
      onPointerCancel={() => {
        setDragging(false)
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
      // The hit area is taller than the track, so the row is easy to grab without
      // making the line itself heavy.
      className="group relative -mx-1 flex h-6 cursor-pointer touch-none items-center px-1 outline-none"
    >
      <div className="relative h-1.5 w-full rounded-full bg-border-strong/60">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${String(ratio * 100)}%`,
            background: tone,
            // Following the pointer must not lag behind it; a settled value glides.
            transition: dragging ? 'none' : 'width 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        />
        {Array.from({ length: steps }, (_, step) => {
          const filled = step / (steps - 1) <= ratio
          return (
            <span
              key={step}
              className="pointer-events-none absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${String((step / (steps - 1)) * 100)}%`,
                background: filled ? 'rgb(0 0 0 / 0.28)' : 'var(--color-faint)',
                opacity: filled ? 0.55 : 0.9,
                transition: 'background 220ms ease, opacity 220ms ease',
              }}
            />
          )
        })}
        <span
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white group-hover:scale-110 group-active:scale-95"
          style={{
            left: `${String(ratio * 100)}%`,
            boxShadow: dragging
              ? `0 0 0 4px color-mix(in srgb, ${tone} 26%, transparent), 0 1px 3px rgb(0 0 0 / 0.5)`
              : `0 0 0 3px color-mix(in srgb, ${tone} 14%, transparent), 0 1px 3px rgb(0 0 0 / 0.45)`,
            transition: dragging
              ? 'transform 120ms ease, box-shadow 120ms ease'
              : 'left 220ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 160ms ease, box-shadow 180ms ease',
          }}
        />
      </div>
    </div>
  )
}
