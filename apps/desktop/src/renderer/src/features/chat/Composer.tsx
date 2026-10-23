import { ArrowUp, Square } from 'lucide-react'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ChatImage } from '@pictor/shared'

import { Button, Kbd } from '../../components/ui/index.js'
import { ModelPicker } from './ModelPicker.js'

/** Refuses anything the runtime could not accept, before the user commits it. */
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_IMAGES = 5

/** Reads one pasted or dropped file into the shape the bridge expects. */
async function toImage(file: File): Promise<ChatImage | null> {
  if (!ACCEPTED.has(file.type)) return null
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0)
  }
  return { mediaType: file.type, data: btoa(binary), name: file.name }
}

export interface ComposerProps {
  disabled: boolean
  running: boolean
  onSend: (prompt: string, images: ChatImage[]) => void
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
  const [images, setImages] = useState<ChatImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  /** Takes whatever image files a paste or a drop carried. */
  async function attach(files: readonly File[]): Promise<void> {
    const accepted = files.filter((file) => ACCEPTED.has(file.type))
    if (accepted.length === 0) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) return
    const loaded = await Promise.all(accepted.slice(0, room).map((file) => toImage(file)))
    setImages((current) => [...current, ...loaded.filter((image) => image !== null)])
  }

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 200))}px`
  }, [value])

  function submit(): void {
    const prompt = value.trim()
    if ((prompt.length === 0 && images.length === 0) || disabled || running) return
    const attached = images
    setValue('')
    setImages([])
    onSend(prompt, attached)
  }

  return (
    <div
      className="rounded-xl border border-border bg-surface p-2 transition-colors duration-150 focus-within:border-border-strong"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        void attach([...event.dataTransfer.files])
      }}
    >
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {images.map((image, index) => (
            <div key={`${image.name ?? 'image'}-${String(index)}`} className="group relative">
              <img
                src={`data:${image.mediaType};base64,${image.data}`}
                alt={image.name ?? '附图'}
                className="size-14 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                aria-label="移除图片"
                onClick={() => setImages((current) => current.filter((_, at) => at !== index))}
                className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-surface-raised text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-text"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={disabled ? '先选择或新建一个会话' : '描述你要完成的任务…'}
        aria-label="消息输入"
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files]
          if (files.length === 0) return
          event.preventDefault()
          void attach(files)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          if (event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        }}
        className="max-h-48 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-faint disabled:cursor-not-allowed"
      />

      {/* The hint block is the first thing to go when the composer is narrow: it
          is a reminder, while the model name is information. */}
      <div className="@container flex items-center gap-2 px-1 pt-1">
        <ModelPicker onChanged={onModelChanged} />

        <span className="ml-auto hidden shrink-0 items-center gap-1 text-2xs text-faint @xl:flex">
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
              disabled={disabled || (value.trim().length === 0 && images.length === 0)}
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
