import { cn } from './cn.js'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  className?: string
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  className,
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50',
        checked ? 'border-accent/60 bg-accent/80' : 'border-border bg-surface-hover',
        className,
      )}
    >
      <span
        className={cn(
          'block size-3.5 rounded-full bg-text shadow transition-transform duration-150',
          checked ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
