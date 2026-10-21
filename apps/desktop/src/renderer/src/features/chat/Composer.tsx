import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, Kbd } from '../../components/ui/index.js'
import { ModelPicker } from './ModelPicker.js'

export interface ComposerProps {
  disabled: boolean
  running: boolean
  onSend: (prompt: string) => void
  onStop: () => void
  /** Called after the active model changed, so the chat can be reopened. */
  onModelChanged?: () => void
}

export function Composer({
  disabled,
  running,
  onSend,
  onStop,
  onModelChanged,
}: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 200))}px`
  }, [value])

  function submit(): void {
    const prompt = value.trim()
    if (prompt.length === 0 || disabled || running) return
    setValue('')
    onSend(prompt)
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-2 transition-colors duration-150 focus-within:border-border-strong">
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={disabled ? '先选择或新建一个会话' : '描述你要完成的任务…'}
        aria-label="消息输入"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          if (event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        }}
        className="max-h-48 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-faint disabled:cursor-not-allowed"
      />

      <div className="flex items-center gap-2 px-1 pt-1">
        <ModelPicker onChanged={onModelChanged} />

        <span className="ml-auto hidden min-w-0 items-center gap-1 truncate text-2xs text-faint sm:flex">
          <Kbd>Enter</Kbd> 发送
          <span className="px-1">·</span>
          <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> 换行
        </span>

        <div className="ml-2 shrink-0">
          {running ? (
            <Button variant="secondary" size="sm" onClick={onStop}>
              <Square className="size-3 fill-current" />
              停止
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={disabled || value.trim().length === 0}
              onClick={submit}
              aria-label="发送"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
