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

/** Distance from the bottom that still counts as "following the stream". */
const FOLLOW_THRESHOLD = 56

export function Transcript({
  messages,
  hasMore,
  loading,
  onLoadOlder,
}: TranscriptProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(true)
  // Mirror of `pinned` for callbacks that run between renders. Reading the state
  // there would act on a stale value: the resize observer fired right after an
  // upward scroll still saw `true` and dragged the view back down, which is why
  // scrolling up took several attempts.
  const pinnedRef = useRef(true)
  const lastTopRef = useRef(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const pin = useCallback((next: boolean) => {
    pinnedRef.current = next
    setPinned(next)
  }, [])

  const stickToBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    scroller.scrollTop = scroller.scrollHeight
    lastTopRef.current = scroller.scrollTop
  }, [])

  // Follow before paint, otherwise the transcript visibly lags a chunk behind.
  useLayoutEffect(() => {
    if (pinnedRef.current) stickToBottom()
  }, [messages, stickToBottom])

  // Streamed text, code blocks and images change the height without changing the
  // message count, so height changes have to be followed too. The observer is
  // attached from a ref callback because the scroller only exists once the
  // transcript actually renders.
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
    pin(true)
    stickToBottom()
  }, [lastRole, messages.length, pin, stickToBottom])

  function handleScroll(): void {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const previous = lastTopRef.current
    lastTopRef.current = scroller.scrollTop

    // Only a real upward move counts as the user taking over. Content growth and
    // scroll anchoring never move scrollTop up, so this cannot fire by accident —
    // unlike a distance check, which unpins the view every time the reply grows.
    if (scroller.scrollTop < previous - 2) {
      pin(false)
      return
    }

    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

    if (!pinnedRef.current) {
      // Back at the bottom, by wheel, scrollbar or keyboard: resume following.
      if (gap < FOLLOW_THRESHOLD) pin(true)
      return
    }

    // Still following: absorb height that landed after our last scroll.
    if (gap > 0) stickToBottom()
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
            pin(true)
            stickToBottom()
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
