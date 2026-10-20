import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-bg hover:bg-accent-strong',
        secondary:
          'border border-border bg-surface-raised text-text hover:border-border-strong hover:bg-surface-hover',
        ghost: 'text-muted hover:bg-surface-hover hover:text-text',
        danger: 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  children?: ReactNode
}

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button type="button" className={cn(button({ variant, size }), className)} {...props} />
}

export interface IconButtonProps extends ButtonProps {
  label: string
}

export function IconButton({
  label,
  className,
  variant = 'ghost',
  size = 'icon',
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn('shrink-0', className)}
      {...props}
    />
  )
}
