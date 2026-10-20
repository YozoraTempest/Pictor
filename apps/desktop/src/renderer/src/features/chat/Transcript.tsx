import { ArrowDown, Loader2, MessagesSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || !pinned) return
    scroller.scrollTop = scroller.scrollHeight
  }, [messages, pinned])

  function handleScroll(): void {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    setPinned(distance < 56)
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
        ref={scrollerRef}
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
            const scroller = scrollerRef.current
            if (scroller !== null) scroller.scrollTop = scroller.scrollHeight
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
