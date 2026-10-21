import { Brain, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '../../lib/cn.js'

/**
 * One stretch of reasoning, rendered as a row inside an activity group.
 *
 * While that reasoning is what is arriving it stays open; once it is done it
 * folds so the answer is what remains. Touching the header pins the state so the
 * fold never fights the reader.
 */
export function ThinkingBlock({ text, live }: { text: string; live: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(live)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (touched) return
    setOpen(live)
  }, [live, touched])

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setTouched(true)
          setOpen((value) => !value)
        }}
        className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        <Brain className={cn('size-3 shrink-0', live ? 'text-accent' : 'text-faint')} aria-hidden />
        <span className="shrink-0 text-2xs text-muted">{live ? '思考中…' : '思考'}</span>
        <span className="shrink-0 text-2xs text-faint">{text.length} 字</span>

        <ChevronDown
          className={cn(
            'ml-auto size-3 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <p className="selectable border-t border-border/60 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-faint">
          {text}
        </p>
      )}
    </li>
  )
}
