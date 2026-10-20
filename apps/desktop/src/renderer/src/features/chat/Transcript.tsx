import { ArrowDown, Loader2, MessagesSquare } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { ChatMessage } from '@pictor/shared'

import { Button, EmptyState } from '../../components/ui/index.js'
import { MessageItem } from './MessageItem.js'

export interface TranscriptProps {
  messages: ChatMessage[]
  hasMore: boolean
  loading: boolean
  onLoadOlder: () => void
}

export function Transcript({
  messages,
  hasMore,
  loading,
  onLoadOlder,
}: TranscriptProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(true)
  // The observer callback outlives a render, so it reads the latest value here.
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  // Set when the user scrolls deliberately; cleared once they are back at the
  // bottom or send a new message.
  const userScrolledRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)

  const stickToBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    scroller.scrollTop = scroller.scrollHeight
  }, [])

  // Layout effect: follow the stream before the frame is painted, otherwise the
  // transcript visibly lags a chunk behind and reads as "stuck".
  useLayoutEffect(() => {
    if (pinned) stickToBottom()
  }, [messages, pinned, stickToBottom])

  // Growing content (streamed text, code blocks, images) changes the height
  // without changing the message count, so height changes must follow too.
  //
  // The observer is attached from a ref callback: the scroller only exists once
  // the transcript actually renders, and an effect keyed on the message count
  // would miss that transition and silently stop following.
  const attachScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scrollerRef.current = node
      observerRef.current?.disconnect()
      observerRef.current = null
      if (node === null) return

      const content = node.firstElementChild
      if (content === null) return

      const observer = new ResizeObserver(() => {
        if (pinnedRef.current) stickToBottom()
      })
      observer.observe(content)
      observerRef.current = observer
    },
    [stickToBottom],
  )

  // Sending a message always means "I want to see what happens next".
  const lastRole = messages.at(-1)?.role
  useEffect(() => {
    if (lastRole !== 'user') return
    userScrolledRef.current = false
    setPinned(true)
  }, [lastRole, messages.length])

  // Browsers move scrollTop by themselves (scroll anchoring) while streamed
  // content grows, so a changed position is not evidence of user intent. Only
  // explicit input counts.
  function handleScroll(): void {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

    if (!userScrolledRef.current) {
      // Nobody took over: keep the newest content in view.
      if (gap > 0) stickToBottom()
      return
    }

    setPinned(gap < 56)
    if (gap < 56) userScrolledRef.current = false
  }

  function markUserScroll(): void {
    userScrolledRef.current = true
  }

  if (loading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-faint">
        <Loader2 className="size-3.5 animate-spin" />
        正在打开会话…
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <EmptyState title="还没有对话" description="在下方描述任务，Agent 会读取项目文件并执行。" />
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={attachScroller}
        onScroll={handleScroll}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        className="h-full overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={onLoadOlder} disabled={loading}>
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MessagesSquare className="size-3.5" />
                )}
                加载更早的消息
              </Button>
            </div>
          )}

          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
        </div>
      </div>

      {!pinned && (
        <button
          type="button"
          onClick={() => {
            stickToBottom()
            setPinned(true)
          }}
          className="absolute right-4 bottom-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-2xs text-muted shadow-popover transition-colors duration-150 hover:text-text"
        >
          <ArrowDown className="size-3" />
          回到最新
        </button>
      )}
    </div>
  )
}
