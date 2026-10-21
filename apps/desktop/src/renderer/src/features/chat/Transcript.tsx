import { ArrowDown, Loader2, MessagesSquare } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button, EmptyState } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import type { AgentPhase } from '../../lib/format-time.js'
import { TurnBlock } from './TurnBlock.js'
import type { Turn } from './turns.js'

export interface TranscriptProps {
  turns: Turn[]
  running: boolean
  phase: AgentPhase
  currentTool: string | null
  hasMore: boolean
  loading: boolean
  onLoadOlder: () => void
  /** Width of the conversation panel; the scroller spans the whole column. */
  panelWidth: number
  /** Exposed so the resizer can sit exactly on the panel's edge. */
  panelRef?: React.Ref<HTMLDivElement>
  /** Animates width changes (window resizes); off while the user drags. */
  animateWidth?: boolean
  /** Input area pinned to the bottom of the panel. */
  footer?: React.ReactNode
  /**
   * A jump requested from the timeline. Carries a nonce so clicking the same turn
   * twice still scrolls.
   */
  jumpTo?: { id: string; nonce: number } | null
}

/** Distance from the bottom that still counts as "following the stream". */
const FOLLOW_THRESHOLD = 56

/** Horizontal breathing room between the panel and the column edges. */
export const PANEL_GUTTER = 24

/** Air left above a jumped-to prompt, so it reads as the top of the exchange. */
const JUMP_TOP_GAP = 16

export function Transcript({
  turns,
  running,
  phase,
  currentTool,
  hasMore,
  loading,
  onLoadOlder,
  panelWidth,
  panelRef,
  animateWidth = false,
  footer,
  jumpTo = null,
}: TranscriptProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(true)
  // Mirror of `pinned` for callbacks that run between renders. Reading the state
  // there would act on a stale value: the resize observer fired right after an
  // upward scroll still saw `true` and dragged the view back down, which is why
  // scrolling up took several attempts.
  const pinnedRef = useRef(true)
  const lastTopRef = useRef(0)
  /** True while a timeline jump animates; the follow rules must stay out of it. */
  const jumpingRef = useRef(false)
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
  }, [turns, stickToBottom])

  /**
   * Timeline jumps live here, not in the rail, because they have to win against
   * follow-the-stream.
   *
   * At the bottom `pinned` is true, and a smooth scroll's first frame moves only a
   * pixel or two — not enough to trip the unpin threshold in `handleScroll`, whose
   * "still following" branch would snap the view straight back to the bottom. So the
   * jump unpins first and then scrolls itself.
   */
  useEffect(() => {
    if (jumpTo === null) return

    const scroller = scrollerRef.current
    const target = document.getElementById(jumpTo.id)
    if (scroller === null || target === null) return

    pin(false)

    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const requested = scroller.scrollTop + top - JUMP_TOP_GAP
    const max = scroller.scrollHeight - scroller.clientHeight
    const next = Math.min(Math.max(requested, 0), max)

    // Hold the follow rules off for the whole animation. Without this, the first
    // scroll event still reports a position near the bottom (the animation has only
    // just started), which re-pins the view and cancels the jump.
    jumpingRef.current = true
    lastTopRef.current = scroller.scrollTop

    const release = (): void => {
      jumpingRef.current = false
      lastTopRef.current = scroller.scrollTop
    }
    scroller.addEventListener('scrollend', release, { once: true })
    window.setTimeout(release, 800)

    scroller.scrollTo({ top: next, behavior: 'smooth' })
  }, [jumpTo, pin])

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
  const lastUser = turns.at(-1)?.user?.id
  useEffect(() => {
    if (lastUser === undefined) return
    pin(true)
    stickToBottom()
  }, [lastUser, pin, stickToBottom])

  function handleScroll(): void {
    const scroller = scrollerRef.current
    if (scroller === null) return

    // A jump drives the scroll itself; treating its frames as user input would
    // re-pin the view and fight the animation.
    if (jumpingRef.current) {
      lastTopRef.current = scroller.scrollTop
      return
    }

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

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* The scroller spans the whole column, so its scrollbar sits outside the
          panel, hard against the column's right edge. */}
      <div
        ref={attachScroller}
        onScroll={handleScroll}
        className="h-full min-w-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        <div
          className="flex min-h-full flex-col"
          style={{ paddingLeft: PANEL_GUTTER, paddingRight: PANEL_GUTTER }}
        >
          {/* One width-constrained column holds the transcript and the input, so
              the panel can be resized while the scrollbar stays outside it. */}
          <div
            ref={panelRef}
            className={cn(
              // flex-1 fills the scroller when the conversation is short, so the
              // composer sits at the bottom even before the first message. Its
              // min-height keeps a long transcript from being squeezed.
              'mx-auto flex min-h-full max-w-full flex-1 flex-col',
              // Width changes from the window or the right panel glide; a drag must
              // track the pointer without lag.
              animateWidth && 'transition-[width] duration-300 ease-out',
            )}
            style={{ width: panelWidth }}
          >
            <div className="flex min-h-0 flex-1 flex-col px-6 pt-6 pb-2">
              {turns.length === 0 ? (
                loading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 text-xs text-faint">
                    <Loader2 className="size-3.5 animate-spin" />
                    正在打开会话…
                  </div>
                ) : (
                  <EmptyState
                    title="还没有对话"
                    description="在下方描述任务，Agent 会读取项目文件并执行。"
                  />
                )
              ) : (
                <>
                  {hasMore && (
                    <div className="flex justify-center pb-4">
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

                  <div className="flex flex-col gap-6">
                    {turns.map((turn, index) => (
                      <TurnBlock
                        key={turn.id}
                        turn={turn}
                        live={running && index === turns.length - 1}
                        phase={phase}
                        currentTool={currentTool}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* The input stays put while the transcript scrolls; its own surface
                keeps the text that passes underneath from showing through. */}
            {footer !== undefined && (
              <div className="sticky bottom-0 bg-bg px-6 pt-3 pb-4">{footer}</div>
            )}
          </div>
        </div>
      </div>

      {!pinned && (
        <button
          type="button"
          onClick={() => {
            pin(true)
            stickToBottom()
          }}
          className="absolute right-8 bottom-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-2xs text-muted shadow-popover transition-colors duration-150 hover:text-text"
        >
          <ArrowDown className="size-3" />
          回到最新
        </button>
      )}
    </div>
  )
}
