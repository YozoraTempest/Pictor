import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export interface MenuItem {
  label: string
  icon?: ReactNode
  /** Renders a check mark instead of the icon, for radio-like choices. */
  checked?: boolean
  danger?: boolean
  /** Right-aligned hint such as `Ctrl+N`. */
  shortcut?: string
  /**
   * Second-level entries. A row that has children opens them instead of running
   * an action, so `onSelect` is only used by leaf rows.
   */
  children?: MenuEntry[]
  onSelect?: () => void
}

export type MenuEntry = MenuItem | 'separator'

export interface MenuProps {
  /** Accessible label for the trigger button. */
  label: string
  trigger: ReactNode
  items: MenuEntry[]
  align?: 'left' | 'right'
  className?: string
  /** Overrides the default square icon-button trigger. */
  triggerClassName?: string
}

const ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors duration-150'

/**
 * Small popover menu used by the title bar and the sidebar's `···` buttons.
 * Closes on outside click, on Escape and after a selection. Rows with children
 * open a second-level menu on hover; one level is enough for an app menu and
 * keeps the keyboard model simple.
 */
export function Menu({
  label,
  trigger,
  items,
  align = 'right',
  className,
  triggerClassName,
}: MenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  /** Key of the row whose submenu is showing. */
  const [submenu, setSubmenu] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSubmenu(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        setSubmenu(null)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function close(): void {
    setOpen(false)
    setSubmenu(null)
  }

  function renderLeaf(entry: MenuItem, key: string): React.JSX.Element {
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        onClick={() => {
          close()
          entry.onSelect?.()
        }}
        className={cn(
          ITEM_CLASS,
          entry.danger
            ? 'text-danger hover:bg-danger/10'
            : 'text-muted hover:bg-surface-hover hover:text-text',
        )}
      >
        <span className="grid size-3.5 shrink-0 place-items-center text-faint">
          {entry.checked === true ? '✓' : entry.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.shortcut !== undefined && (
          <span className="shrink-0 pl-4 text-2xs text-faint">{entry.shortcut}</span>
        )}
      </button>
    )
  }

  function renderEntry(entry: MenuEntry, key: string): React.JSX.Element {
    if (entry === 'separator') return <div key={key} className="my-1 h-px bg-border" />
    if (entry.children === undefined) return renderLeaf(entry, key)

    const expanded = submenu === key

    return (
      <div
        key={key}
        className="relative"
        onPointerEnter={() => {
          setSubmenu(key)
        }}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={expanded}
          onClick={() => {
            // Hover already opened it on pointer devices, so a click must not
            // toggle it shut again.
            setSubmenu(key)
          }}
          className={cn(
            ITEM_CLASS,
            'text-muted hover:bg-surface-hover hover:text-text',
            expanded && 'bg-surface-hover text-text',
          )}
        >
          <span className="grid size-3.5 shrink-0 place-items-center text-faint">{entry.icon}</span>
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          <ChevronRight className="size-3 shrink-0 text-faint" aria-hidden />
        </button>

        {expanded && (
          <div
            role="menu"
            aria-label={entry.label}
            className="absolute top-0 left-full z-50 ml-0.5 flex w-60 flex-col gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-popover"
          >
            {entry.children.map((child, index) =>
              child === 'separator' ? (
                <div key={`sep-${String(index)}`} className="my-1 h-px bg-border" />
              ) : (
                renderLeaf(child, `${key}-${String(index)}`)
              ),
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) close()
          else {
            setSubmenu(null)
            setOpen(true)
          }
        }}
        className={cn(
          'grid size-6 place-items-center rounded-sm text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40',
          triggerClassName,
        )}
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
          {items.map((item, index) => renderEntry(item, `entry-${String(index)}`))}
        </div>
      )}
    </div>
  )
}
