import { AlertTriangle, MessageSquarePlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Badge, Banner, Button, EmptyState } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { formatDuration, newSessionTitle, phaseLabel } from '../../lib/format-time.js'
import { useChatStore } from './chat-store.js'
import { Composer } from './Composer.js'
import { ProjectPicker } from './ProjectPicker.js'
import { PANEL_GUTTER, Transcript } from './Transcript.js'
import { Timeline } from './Timeline.js'
import { toolLabel } from './tool-presenters.js'
import { buildTurns } from './turns.js'

/** Panel width bounds; the upper one also yields to the column's own width. */
const MIN_PANEL_WIDTH = 520
const MAX_PANEL_WIDTH = 1200
const DEFAULT_PANEL_WIDTH = 860

export function ChatView(): React.JSX.Element {
  const sessions = useWorkspaceStore((state) => state.sessions)

  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const setSessionSections = useWorkspaceStore((state) => state.setSessionSections)
  const draft = useWorkspaceStore((state) => state.draft)
  const startDraft = useWorkspaceStore((state) => state.startDraft)
  const clearDraft = useWorkspaceStore((state) => state.clearDraft)
  const setDraftProject = useWorkspaceStore((state) => state.setDraftProject)
  const messages = useChatStore((state) => state.messages)
  const running = useChatStore((state) => state.running)
  const phase = useChatStore((state) => state.phase)
  const currentTool = useChatStore((state) => state.currentTool)
  const runStartedAt = useChatStore((state) => state.runStartedAt)
  const runFinishedAt = useChatStore((state) => state.runFinishedAt)
  const loading = useChatStore((state) => state.loading)
  const hasMore = useChatStore((state) => state.hasMore)

  const error = useChatStore((state) => state.error)
  const send = useChatStore((state) => state.send)
  const stop = useChatStore((state) => state.stop)
  const loadOlder = useChatStore((state) => state.loadOlder)

  const turns = useMemo(() => buildTurns(messages), [messages])
  const session = sessions.find((entry) => entry.id === selectedSessionId) ?? null

  const columnRef = useRef<HTMLDivElement | null>(null)
  const panelNodeRef = useRef<HTMLDivElement | null>(null)
  const panelObserverRef = useRef<ResizeObserver | null>(null)

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  /** Distance from the column's left edge to the panel's right edge. */
  const [panelRight, setPanelRight] = useState(0)
  const [resizing, setResizing] = useState(false)
  /** A timeline jump; the nonce lets the same turn be jumped to twice. */
  const [jumpTo, setJumpTo] = useState<{ id: string; nonce: number } | null>(null)

  /** Keeps the panel inside its column, leaving the outer gutter for the scrollbar. */
  const clampWidth = useCallback((next: number): number => {
    const column = columnRef.current
    const available = column === null ? MAX_PANEL_WIDTH : column.clientWidth - PANEL_GUTTER * 2 - 8
    const ceiling = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, available))
    return Math.max(MIN_PANEL_WIDTH, Math.min(next, ceiling))
  }, [])

  /** Places the handle on the panel's right edge, wherever centring put it. */
  const measurePanel = useCallback(() => {
    const panel = panelNodeRef.current
    if (panel === null) return
    setPanelRight(panel.offsetLeft + panel.offsetWidth)
  }, [])

  /**
   * Observes the panel from a ref callback rather than an effect.
   *
   * The panel animates its width, and window or panel toggles move it without any
   * React render, so measuring on render alone left the handle behind at a stale
   * position. A ResizeObserver on the node itself reports every frame of the
   * transition, which keeps the handle glued to the edge.
   */
  const attachPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelObserverRef.current?.disconnect()
      panelObserverRef.current = null
      panelNodeRef.current?.removeEventListener('transitionend', measurePanel)
      panelNodeRef.current = node
      if (node === null) return

      measurePanel()
      const observer = new ResizeObserver(() => measurePanel())
      observer.observe(node)
      panelObserverRef.current = observer

      // The width can reach its final value while the column is still widening, so
      // the last resize callback may run before centring settles. The end of the
      // transition is the one moment guaranteed to be after the final layout.
      node.addEventListener('transitionend', measurePanel)
    },
    [measurePanel],
  )

  // A narrower window must not leave the panel wider than its column.
  useEffect(() => {
    const column = columnRef.current
    if (column === null) return

    const observer = new ResizeObserver(() => {
      setPanelWidth((width) => clampWidth(width))
      measurePanel()
    })
    observer.observe(column)
    measurePanel()
    return () => observer.disconnect()
  }, [clampWidth, measurePanel])

  /**
   * Drags the right edge: the panel stays centred, so moving right widens it by
   * twice the distance travelled.
   */

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = panelWidth

    // Capture keeps the drag alive when the pointer leaves the handle; a synthetic
    // pointer id has no active pointer, so the throw must not abort the drag.
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // No active pointer to capture (tests, synthetic events) — window listeners
      // below still drive the drag.
    }
    setResizing(true)

    const move = (moveEvent: PointerEvent): void => {
      setPanelWidth(clampWidth(startWidth + (moveEvent.clientX - startX) * 2))
    }

    const finish = (): void => {
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  /** Live run state; it belongs beside the composer, not over the transcript. */
  const status = running ? (
    <Badge tone="accent" className="self-start">
      {phaseLabel(phase, currentTool === null ? null : toolLabel(currentTool))}
    </Badge>
  ) : runStartedAt !== null && runFinishedAt !== null ? (
    <span className="self-start text-2xs text-faint">
      用时 {formatDuration(runFinishedAt - runStartedAt)}
    </span>
  ) : null

  /**
   * Sends a prompt. A draft has no session yet, so the first prompt creates one —
   * with the project the draft carries — and files it into its section.
   */
  async function submit(prompt: string): Promise<void> {
    if (draft === null) {
      await send(prompt)
      return
    }

    const created = await createSession(newSessionTitle(), draft.projectId)
    if (created === null) return

    if (draft.sectionId !== null) await setSessionSections(created.id, [draft.sectionId])
    clearDraft()

    // Open explicitly: the store's own effect may not have run yet, and `send`
    // needs the session's transcript path.
    await useChatStore.getState().open(created.id)
    await useChatStore.getState().send(prompt)
  }

  /**
   * The host reads the model when a chat is opened, so a switch only lands on the
   * next open. Reopening here makes it apply to the conversation in view — unless
   * a run is in flight, where reopening would cancel it.
   */
  async function handleModelChanged(): Promise<void> {
    if (running) return
    const sessionId = useWorkspaceStore.getState().selectedSessionId
    if (sessionId === null) return

    await window.pictor.closeChat()
    await useChatStore.getState().open(sessionId)
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-bg">
      {error !== null && (
        <div className="px-4 pt-3">
          <Banner tone="error">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="size-3" />
              {error}
            </span>
          </Banner>
        </div>
      )}

      {session === null && draft === null ? (
        <EmptyState
          title="选择或新建会话"
          description="在左侧项目下新建一个会话，然后开始对话。"
          action={
            <Button size="sm" variant="secondary" onClick={() => startDraft({ sectionId: null })}>
              <MessageSquarePlus className="size-3.5" />
              新建会话
            </Button>
          }
        />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          {/* Timeline lives outside the conversation panel, on the far left. */}
          <Timeline turns={turns} onJump={(id) => setJumpTo({ id, nonce: Date.now() })} />
          {/* min-w-0 keeps the column from being widened by the fixed-width panel,
              so opening the right panel narrows the conversation instead of letting
              it spill over the timeline. */}
          <div
            ref={columnRef}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <Transcript
              turns={turns}
              running={running}
              phase={phase}
              currentTool={currentTool}
              hasMore={hasMore}
              loading={loading}
              onLoadOlder={() => void loadOlder()}
              panelWidth={panelWidth}
              panelRef={attachPanel}
              animateWidth={!resizing}
              jumpTo={jumpTo}
              footer={
                <div className="flex flex-col gap-2">
                  {status}
                  {draft !== null && (
                    <ProjectPicker projectId={draft.projectId} onChange={setDraftProject} />
                  )}
                  <Composer
                    disabled={false}
                    onModelChanged={() => void handleModelChanged()}
                    running={running}
                    onSend={(prompt) => void submit(prompt)}
                    onStop={() => void stop()}
                  />
                </div>
              }
            />

            {/* Drag handle on the panel's right edge. The rule is faintly visible so
                the edge reads as draggable, and brightens on hover or during a drag. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整对话区宽度"
              onPointerDown={startResize}
              onDoubleClick={() => setPanelWidth(clampWidth(DEFAULT_PANEL_WIDTH))}
              className="group absolute top-0 bottom-0 z-10 w-4 -translate-x-1/2 cursor-col-resize touch-none"
              style={{ left: panelRight }}
            >
              <span
                className={cn(
                  'absolute top-1/2 left-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong opacity-0 transition-all duration-150 group-hover:h-16 group-hover:opacity-100',
                  resizing && 'h-16 opacity-100',
                )}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
