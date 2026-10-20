import { useEffect, useMemo, useRef, useState } from 'react'

import type { ChatMessage } from '@pictor/shared'

interface Props {
  sessionId: string | null
  projectName: string
}

const PAGE_SIZE = 50

export function ChatPanel({ sessionId, projectName }: Props): React.JSX.Element {
  const [path, setPath] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (sessionId === null) {
      setPath(null)
      setMessages([])
      setOffset(0)
      setHasMore(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      const result = await window.pictor.openChat(sessionId)
      if (cancelled) return
      setPath(result.path)
      setMessages(result.history.messages)
      setOffset(result.history.nextOffset)
      setHasMore(result.history.hasMore)
    })()
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      void window.pictor.closeChat()
    }
  }, [sessionId])

  useEffect(() => {
    return window.pictor.onChatEvent((event) => {
      if (event.sessionId !== sessionId) return

      if (event.type === 'run.started') {
        setRunning(true)
        return
      }

      if (event.type === 'message.delta') {
        setMessages((current) => {
          const last = current.at(-1)
          if (last !== undefined && last.id === `stream-${event.runId}`) {
            return [...current.slice(0, -1), { ...last, text: last.text + event.text }]
          }
          return [
            ...current,
            {
              id: `stream-${event.runId}`,
              role: 'assistant',
              text: event.text,
              timestamp: Date.now(),
            },
          ]
        })
        return
      }

      if (event.type === 'tool.started') {
        setMessages((current) => [
          ...current,
          {
            id: `tool-${event.runId}-${current.length}`,
            role: 'tool',
            text: `running ${event.tool}`,
            timestamp: Date.now(),
            toolName: event.tool,
          },
        ])
        return
      }

      if (event.type === 'tool.finished') {
        setMessages((current) => [
          ...current,
          {
            id: `tool-${event.runId}-${current.length}`,
            role: 'tool',
            text: event.output.slice(0, 4000),
            timestamp: Date.now(),
            toolName: event.tool,
            isError: event.isError,
          },
        ])
        return
      }

      setRunning(false)
      if (event.reason === 'error') setError(event.message ?? 'run failed')
    })
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const title = useMemo(
    () => (sessionId === null ? 'Select a session' : projectName),
    [sessionId, projectName],
  )

  async function send(): Promise<void> {
    const prompt = input.trim()
    if (prompt.length === 0 || path === null || running) return

    setInput('')
    setError(null)
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text: prompt, timestamp: Date.now() },
    ])

    try {
      await window.pictor.sendChat(prompt)
    } catch (reason) {
      setRunning(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function loadOlder(): Promise<void> {
    if (path === null || !hasMore) return
    const page = await window.pictor.chatHistory(path, PAGE_SIZE, offset)
    setMessages((current) => [...page.messages, ...current])
    setOffset(page.nextOffset)
    setHasMore(page.hasMore)
  }

  return (
    <section className="chat-panel">
      <div className="chat-head">
        <strong>{title}</strong>
        {path !== null && <span className="path">{path}</span>}
      </div>

      {error !== null && <div className="error">{error}</div>}

      <div className="transcript">
        {sessionId === null && <p className="muted">Select or create a session to start.</p>}
        {loading && <p className="muted">Opening session…</p>}

        {hasMore && (
          <button type="button" className="ghost load-older" onClick={() => void loadOlder()}>
            Load older messages
          </button>
        )}

        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <header>
              <span>{message.role === 'tool' ? (message.toolName ?? 'tool') : message.role}</span>
              {message.timestamp !== null && (
                <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
              )}
            </header>
            <pre>{message.text}</pre>
          </article>
        ))}

        {running && <p className="muted">Agent is working…</p>}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          value={input}
          placeholder="Ask the agent…"
          disabled={sessionId === null}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <div className="composer-actions">
          <span className="muted">Enter 发送 · Shift+Enter 换行</span>
          {running ? (
            <button type="button" onClick={() => void window.pictor.stopChat()}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              disabled={sessionId === null || input.trim().length === 0}
              onClick={() => void send()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
