import { useEffect, useState } from 'react'

import { isLocalSubagent, type ChatMessage, type ChatSubagent } from '@vulonlok/shared'

import { Banner, Dialog, Spinner } from '../../components/ui/index.js'
import { buildTurns } from './turns.js'
import { TurnBlock } from './TurnBlock.js'

/**
 * What one child agent actually did.
 *
 * A subagent is a session of its own, so this is a read of *that* log rather than a slice
 * of the parent's transcript: it is shown in a dialog because it belongs somewhere else,
 * and drawing it inline would claim the conversation said these things. The read happens
 * when the dialog opens, which is also the only moment anyone is looking — the snapshot
 * is what the child had committed by then, and reopening gets the rest.
 *
 * Rendered through the same `TurnBlock` the transcript uses, so a child's tool calls and
 * answers look like work instead of like a second, thinner log format.
 */
export function SubagentDialog({
  sessionId,
  subagent,
  onClose,
}: {
  sessionId: string
  subagent: ChatSubagent
  onClose: () => void
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setMessages(null)
    setError(null)
    void window.pictor
      .childTranscript(sessionId, subagent.id, subagent.mode)
      .then((rows) => {
        if (alive) setMessages(rows)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [sessionId, subagent.id, subagent.mode])

  const turns = messages === null ? [] : buildTurns(messages)

  return (
    <Dialog open title={`子代理 · ${subagent.label}`} onClose={onClose}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        {error !== null && <Banner tone="error">{error}</Banner>}

        {error === null && messages === null && (
          <div className="flex items-center gap-2 px-1 py-2 text-2xs text-faint">
            <Spinner className="size-3.5" />
            读取子代理的记录
          </div>
        )}

        {messages !== null && messages.length === 0 && (
          <p className="px-1 py-2 text-2xs leading-relaxed text-faint">
            这个子代理还没有留下任何内容。
          </p>
        )}

        {turns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} live={false} phase="idle" currentTool={null} />
        ))}

        {!isLocalSubagent(subagent) && (
          <p className="px-1 text-2xs leading-relaxed text-faint">
            这个子代理跑在外部 provider 上，本地没有它的记录。
          </p>
        )}
      </div>
    </Dialog>
  )
}
