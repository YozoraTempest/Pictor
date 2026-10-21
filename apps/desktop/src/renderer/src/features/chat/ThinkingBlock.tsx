import { Brain, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '../../lib/cn.js'

/**
 * The agent's reasoning for one stretch of a turn.
 *
 * While the run is live the text streams in and stays open; once the run ends it
 * folds itself so the answer is what remains. Touching the header pins the state
 * so the fold never fights the reader.
 */
export function ThinkingBlock({
  text,
  running,
}: {
  text: string
  running: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(running)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (touched) return
    setOpen(running)
  }, [running, touched])

  return (
    <div className="rounded-lg border border-border/70 bg-surface/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setTouched(true)
          setOpen((value) => !value)
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        <Brain className={cn('size-3.5 shrink-0', running ? 'text-accent' : 'text-faint')} />
        <span className="truncate text-xs text-muted">{running ? '思考中…' : '思考过程'}</span>
        <span className="shrink-0 text-2xs text-faint">{text.length} 字</span>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 text-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <p className="selectable border-t border-border/70 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-faint">
          {text}
        </p>
      )}
    </div>
  )
}
