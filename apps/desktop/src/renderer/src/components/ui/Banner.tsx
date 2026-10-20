import { AlertTriangle, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'
import { IconButton } from './Button.js'

export type BannerTone = 'error' | 'notice'

export interface BannerProps {
  tone: BannerTone
  children: ReactNode
  onDismiss?: () => void
  className?: string
}

export function Banner({ tone, children, onDismiss, className }: BannerProps): React.JSX.Element {
  const Icon = tone === 'error' ? AlertTriangle : Info

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'error'
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-accent/30 bg-accent/10 text-accent-strong',
        className,
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onDismiss !== undefined && (
        <IconButton label="关闭" className="size-5" onClick={onDismiss}>
          <X className="size-3" />
        </IconButton>
      )}
    </div>
  )
}
