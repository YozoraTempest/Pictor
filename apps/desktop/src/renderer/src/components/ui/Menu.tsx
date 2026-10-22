import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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

const MENU_WIDTH = 192
/** `w-60`; the submenu is wider than the panel, so it needs its own estimate. */
const SUBMENU_WIDTH = 240
/** Gap between a row and the submenu beside it. */
const SUBMENU_GAP = 2
/** Gap between the trigger and the menu, and the least distance to the viewport. */
const OFFSET = 4
const VIEWPORT_MARGIN = 8

/**
 * Small popover menu used by the title bar and the sidebar's `···` buttons.
 * Closes on outside click, on Escape and after a selection. Rows with children
 * open a second-level menu on hover; one level is enough for an app menu and
 * keeps the keyboard model simple.
 *
 * The popover renders into a portal: sidebar rows are hover-revealed (opacity)
 * inside a scrolling list, and both of those would otherwise clip the menu or
 * paint later rows over it.
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
  /** Viewport coordinates of the open submenu, clamped to the window. */
  const [submenuPosition, setSubmenuPosition] = useState<{ top: number; left: number } | null>(null)
  /** Viewport coordinates once the popover has been measured. */
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback((): void => {
    setOpen(false)
    setSubmenu(null)
    setPosition(null)
  }, [])

  /**
   * Opens a row's submenu beside it, clamped to the window.
   *
   * The submenu is wider than the panel and sits next to it, so a panel anchored
   * near an edge — the `···` menu in the title bar is exactly that — used to push
   * the second level off screen. Measuring the row and clamping the result keeps
   * it visible whatever the window is doing: on a wide window it opens to the
   * right, and near the edge it slides back inside.
   */
  function openSubmenu(key: string, row: HTMLElement): void {
    const rect = row.getBoundingClientRect()
    const width = Math.min(SUBMENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right + SUBMENU_GAP),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    )

    setSubmenuPosition({ top: rect.top, left })
    setSubmenu(key)
  }

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return

    const rect = trigger.getBoundingClientRect()
    const menu = menuRef.current
    const width = menu?.offsetWidth ?? MENU_WIDTH
    const height = menu?.offsetHeight ?? 0

    const wanted = align === 'right' ? rect.right - width : rect.left
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, wanted),
      window.innerWidth - width - VIEWPORT_MARGIN,
    )

    // Open upwards when there is no room below, which is the common case for the
    // rows near the bottom of the sidebar.
    const below = rect.bottom + OFFSET
    const above = rect.top - OFFSET - height
    const top =
      height > 0 && below + height > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, above)
        : below

    setPosition({ top, left })
  }, [align])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) === true) return
      if (menuRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onViewportChange = (): void => {
      place()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, close, place])

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
        onPointerEnter={(event) => {
          openSubmenu(key, event.currentTarget)
        }}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={expanded}
          onClick={(event) => {
            // Hover already opened it on pointer devices, so a click must not
            // toggle it shut again.
            openSubmenu(key, event.currentTarget)
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
            style={
              submenuPosition === null
                ? undefined
                : { top: submenuPosition.top, left: submenuPosition.left }
            }
            className="fixed z-50 flex max-h-[70vh] w-60 max-w-[calc(100vw-1rem)] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-popover"
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
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setSubmenu(null)
          setPosition(null)
          setOpen(true)
        }}
        className={cn(
          'grid size-6 place-items-center rounded-sm text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40',
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex w-48 flex-col gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-popover"
          >
            {items.map((item, index) => renderEntry(item, `entry-${String(index)}`))}
          </div>,
          document.body,
        )}
    </div>
  )
}
