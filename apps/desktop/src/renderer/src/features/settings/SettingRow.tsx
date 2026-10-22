import type { ReactNode } from 'react'

import { Button } from '../../components/ui/index.js'
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
  control,
  stacked = false,
  disabled = false,
  disabledReason,
}: {
  /** Stable id, so a search result can jump to this row. */
  id?: string
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

/**
 * The footer of a form whose values are saved by hand.
 *
 * It only appears once there is something to save, so a page that is already in
 * sync does not advertise an action that would do nothing.
 */
export function SettingActions({
  dirty,
  busy = false,
  onSave,
  onDiscard,
  saveLabel = '保存',
}: {
  dirty: boolean
  busy?: boolean
  onSave: () => void
  onDiscard: () => void
  saveLabel?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2.5">
      <span className="mr-auto text-2xs text-faint">{dirty ? '有未保存的修改' : '已保存'}</span>
      <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={onDiscard}>
        撤销
      </Button>
      <Button variant="primary" size="sm" disabled={!dirty || busy} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  )
}
