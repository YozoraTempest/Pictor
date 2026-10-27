import { ArrowUp, Square } from 'lucide-react'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { CatalogSkill, ChatImage } from '@vulonlok/shared'

import type { KernelCommand } from '../../../../shared/bridge.js'

import { Button } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { useChatStore } from './chat-store.js'
import { ContextMeter } from './ContextMeter.js'
import { KernelPicker } from './KernelPicker.js'
import { KernelModelPicker } from './KernelModelPicker.js'
import { ModelPicker } from './ModelPicker.js'
import { SessionApprovalPicker } from './SessionApprovalPicker.js'
import { SessionPermissionPicker } from './SessionPermissionPicker.js'
import {
  commandLineOf,
  slashEntries,
  slashTokenAt,
  type SlashEntry,
  type SlashToken,
} from './slash.js'

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
  /**
   * Whether the composer offers the kernel choice.
   *
   * A page that is one kernel's workspace has already answered that question, and
   * a picker there would offer to leave the page it sits on.
   */
  showKernelPicker?: boolean
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
  showKernelPicker = true,
  onModelChanged,
}: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [images, setImages] = useState<ChatImage[]>([])
  const [skills, setSkills] = useState<CatalogSkill[] | null>(null)
  // The kernel's own commands, listed beside the skills: both are typed with `/`, and
  // one of them runs on the kernel instead of being sent to the model.
  const [commands, setCommands] = useState<KernelCommand[] | null>(null)
  const [slash, setSlash] = useState<SlashToken | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const sessionId = useChatStore((state) => state.current.sessionId)

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

  // The catalog belongs to the conversation, so it is read when a `/` starts a
  // token rather than on mount: most drafts never ask for a skill.
  useEffect(() => {
    if (slash === null || sessionId.length === 0) return
    let alive = true
    // Two sources, one menu: a kernel that offers no commands contributes nothing,
    // and a runtime that cannot list skills still shows its commands.
    if (skills === null) {
      void window.pictor
        .listSkills(sessionId)
        .then((next) => {
          if (alive) setSkills(next)
        })
        .catch(() => {
          // A runtime that cannot answer leaves that half of the menu empty; the draft
          // is still sendable, and the runtime ignores an unknown `/name`.
          if (alive) setSkills([])
        })
    }
    if (commands === null) {
      void window.pictor
        .kernelCommands(sessionId)
        .then((next) => {
          if (alive) setCommands(next)
        })
        .catch(() => {
          if (alive) setCommands([])
        })
    }
    return () => {
      alive = false
    }
  }, [slash, skills, commands, sessionId])

  const matches = useMemo(
    () => (slash === null ? [] : slashEntries(commands ?? [], skills ?? [], slash.query)),
    [slash, commands, skills],
  )

  useEffect(() => {
    setActive(0)
  }, [slash?.query, skills, commands])

  // Above the textarea, so the menu never covers the words being typed under it.
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null || slash === null || matches.length === 0) {
      setAnchor(null)
      return
    }
    const rect = textarea.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 220), 380)
    setAnchor({
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      bottom: window.innerHeight - rect.top + 6,
      width,
    })
  }, [slash, matches.length])

  // Clicking elsewhere abandons the menu without touching the draft.
  useEffect(() => {
    if (slash === null) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) === true) return
      if (textareaRef.current?.contains(target) === true) return
      setSlash(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [slash])

  function choose(entry: SlashEntry): void {
    if (slash === null) return
    // A command that takes no words gets no trailing space, so it can be sent the
    // moment it is picked; the others leave room for their input.
    const tail = entry.kind === 'command' && entry.input === undefined ? '' : ' '
    const next = `${value.slice(0, slash.start)}/${entry.name}${tail}${value.slice(slash.end)}`
    const caret = slash.start + entry.name.length + 1 + tail.length
    setValue(next)
    setSlash(null)
    // The menu closes on the same tick; the caret has to be placed after the
    // value React writes, or it jumps to the end of the draft.
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea === null) return
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  function submit(): void {
    const prompt = value.trim()
    if ((prompt.length === 0 && images.length === 0) || disabled || running) return

    // A line that names one of the kernel's commands belongs to the kernel: sending it
    // as a prompt would hand the model the words someone meant for `/compact`.
    const line = commandLineOf(prompt, commands ?? [])
    if (line !== null && sessionId.length > 0) {
      setValue('')
      setImages([])
      setSlash(null)
      void window.pictor
        .runKernelCommand(sessionId, line)
        .then((said) => {
          if (said !== null) useWorkspaceStore.getState().setNotice(said)
        })
        .catch((reason: unknown) => {
          useWorkspaceStore
            .getState()
            .setError(reason instanceof Error ? reason.message : String(reason))
        })
      return
    }

    const attached = images
    setValue('')
    setImages([])
    setSlash(null)
    onSend(prompt, attached)
  }

  return (
    <>
      <div
        className="rounded-xl border border-border bg-surface p-2 focus-within:border-border-strong focus-within:ring-1 focus-within:ring-accent/20"
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
          onChange={(event) => {
            const next = event.target.value
            setValue(next)
            setSlash(slashTokenAt(next, event.target.selectionStart))
          }}
          onKeyUp={(event) => {
            // Moving the caret back into a `/` token reopens the menu.
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
              const caret = event.currentTarget.selectionStart
              setSlash(slashTokenAt(event.currentTarget.value, caret))
            }
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files]
            if (files.length === 0) return
            event.preventDefault()
            void attach(files)
          }}
          onKeyDown={(event) => {
            if (slash !== null && matches.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => (index + 1) % matches.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => (index - 1 + matches.length) % matches.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const entry = matches[active]
                if (entry !== undefined) {
                  event.preventDefault()
                  choose(entry)
                  return
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setSlash(null)
                return
              }
            }
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          className="max-h-48 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-faint disabled:cursor-not-allowed"
        />

        {/* One row: the sandbox the turn runs under sits at the leading edge, so
            it reads as a property of the conversation rather than of the model;
            usage, model and the action stay together on the trailing edge. */}
        <div className="flex items-center gap-1 px-1 pt-1">
          <SessionPermissionPicker />
          <SessionApprovalPicker />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {showKernelPicker && <KernelPicker />}
            <ContextMeter />
            <ModelPicker onChanged={onModelChanged} />
            <KernelModelPicker />
            {running ? (
              <Button variant="secondary" size="sm" className="ml-1" onClick={onStop}>
                <Square className="size-3 fill-current" />
                停止
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                className="ml-1 rounded-full"
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

      {/* The menu is a portal for the same reason the model picker is: the
          composer sits inside panels that clip their children. */}
      {slash !== null &&
        matches.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="选择技能"
            style={{
              left: anchor?.left ?? 0,
              bottom: anchor?.bottom ?? 0,
              width: anchor?.width ?? 240,
              visibility: anchor === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex max-h-64 flex-col overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-popover"
          >
            {matches.map((entry, index) => (
              <button
                key={`${entry.kind}:${entry.name}`}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(entry)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-150',
                  index === active ? 'bg-surface-hover' : 'bg-transparent',
                )}
              >
                <span className="flex items-center gap-1.5 font-mono text-xs text-text">
                  /{entry.name}
                  {/* Which half this row came from: a command runs on the kernel, a
                      skill is instructions the model reads. */}
                  <span className="rounded-sm bg-surface-hover px-1 text-2xs text-faint">
                    {entry.kind === 'command' ? '命令' : '技能'}
                  </span>
                </span>
                <span className="line-clamp-1 text-2xs text-faint">{entry.description}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
