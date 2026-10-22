import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/cn.js'

export interface SelectOption {
  value: string
  label: ReactNode
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  className?: string
  'aria-label'?: string
  disabled?: boolean
}

const ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors duration-150'

const OFFSET = 4
const VIEWPORT_MARGIN = 8

/**
 * The styled cousin of the native dropdown.
 *
 * A native `<select>` opens whatever popup the platform ships, which is the one
 * surface in the app that ignores the theme entirely. This one draws the popup
 * itself — same panel, rows and check mark as `Menu` — while keeping the small
 * contract a form field needs: a value, an `onChange`, and a list of options.
 */
export function Select({
  value,
  onChange,
  options,
  className,
  disabled = false,
  'aria-label': ariaLabel,
}: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  /** Index highlighted with the keyboard; follows the mouse as well. */
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const selected = options.find((option) => option.value === value) ?? null
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  const close = useCallback((): void => {
    setOpen(false)
    setPosition(null)
  }, [])

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (trigger === null) return

    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, panel?.offsetWidth ?? 0)
    const height = panel?.offsetHeight ?? 0

    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    )

    // Drop down by default; flip up when the trigger sits near the bottom, which
    // is the common case for the last field of a dialog.
    const below = rect.bottom + OFFSET
    const above = rect.top - OFFSET - height
    const top =
      height > 0 && below + height > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, above)
        : below

    setPosition({ top, left, width })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])

  // The popup is pinned to the viewport, so it follows the trigger when the page
  // scrolls or the window changes size.
  useLayoutEffect(() => {
    if (!open) return

    const onViewportChange = (): void => place()
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) === true) return
      if (panelRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, place, close])

  /** Arrow keys walk the options; Enter confirms the highlighted one. */
  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setActive(selectedIndex)
        setOpen(true)
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(options.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option !== undefined) {
        onChange(option.value)
        close()
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setActive(selectedIndex)
          setOpen(true)
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 text-sm text-text transition-colors duration-150 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50',
          className,
        )}
      >
        <span className="truncate">{selected !== null ? selected.label : '\u00a0'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" aria-hidden />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: position?.width ?? undefined,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-[60] flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-popover"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    onChange(option.value)
                    close()
                  }}
                  className={cn(
                    ITEM_CLASS,
                    index === active
                      ? 'bg-surface-hover text-text'
                      : 'text-muted hover:bg-surface-hover hover:text-text',
                  )}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center text-faint">
                    {isSelected ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
