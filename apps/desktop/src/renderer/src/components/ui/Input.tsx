import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

import { cn } from '../../lib/cn.js'

const fieldBase =
  'w-full rounded-md border border-border bg-bg px-3 text-sm text-text placeholder:text-faint transition-colors duration-150 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={cn(fieldBase, 'h-9', className)} {...props} />
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea className={cn(fieldBase, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
  )
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select className={cn(fieldBase, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
}
