import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export interface MenuItem {
  label: string
  icon?: ReactNode
  /** Renders a check mark instead of the icon, for radio-like choices. */
  checked?: boolean
  danger?: boolean
  onSelect: () => void
}

export type MenuEntry = MenuItem | 'separator'

export interface MenuProps {
  /** Accessible label for the trigger button. */
  label: string
  trigger: ReactNode
  items: MenuEntry[]
  align?: 'left' | 'right'
  className?: string
}

/**
 * Small popover menu used by the sidebar's `···` buttons. Closes on outside
 * click, on Escape and after a selection.
 */
export function Menu({
  label,
  trigger,
  items,
  align = 'right',
  className,
}: MenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid size-6 place-items-center rounded-sm text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {trigger}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-50 mt-1 flex w-48 flex-col gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-popover',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <div key={`sep-${String(index)}`} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors duration-150',
                  item.danger
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-muted hover:bg-surface-hover hover:text-text',
                )}
              >
                <span className="grid size-3.5 shrink-0 place-items-center text-faint">
                  {item.checked === true ? '✓' : item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
