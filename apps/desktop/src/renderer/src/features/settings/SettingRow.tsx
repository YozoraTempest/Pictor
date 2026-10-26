import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'
import { useSettingHighlight } from './highlight.js'

/**
 * One setting: a label, an explanation, and the control that owns the value.
 *
 * The save semantics live in the control, not here: a switch writes at once, a
 * text field stages changes in a form, and a dangerous action goes through a
 * confirmation. The row only owns layout and the reason a control is disabled,
 * which keeps every page looking the same without hiding how it behaves.
 */
export function SettingRow({
  id,
  title,
  description,
  note,
  control,
  stacked = false,
  disabled = false,
  disabledReason,
}: {
  /** Stable id, so a search result can jump to this row. */
  id?: string
  /**
   * One line about what the current value means — a path, a resolved name.
   *
   * Kept out of the control column on purpose: a directory is the whole point of
   * such a line, and truncating it there would hide it.
   */
  note?: string
  title: string
  description?: string
  control: ReactNode
  /** Puts the control below the label, for groups that need the full width. */
  stacked?: boolean
  disabled?: boolean
  disabledReason?: string
}): React.JSX.Element {
  const highlighted = useSettingHighlight(id)

  return (
    <div
      data-setting-row={id}
      className={cn(
        'flex gap-4 px-4 py-3 transition-colors duration-300',
        stacked ? 'flex-col' : 'flex-wrap items-start justify-between',
        highlighted && 'bg-accent/10',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text">{title}</p>
        {description !== undefined && <p className="mt-0.5 text-2xs text-faint">{description}</p>}
        {note !== undefined && (
          <p className="mt-1 break-all font-mono text-2xs text-faint">{note}</p>
        )}
        {disabled && disabledReason !== undefined && (
          <p className="mt-0.5 text-2xs text-faint">{disabledReason}</p>
        )}
      </div>

      <div
        className={cn(
          'min-w-0',
          stacked ? 'w-full' : 'shrink-0',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        {control}
      </div>
    </div>
  )
}
