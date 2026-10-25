import { ShieldQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ApprovalRequest } from '@pictor/shared'

import { useApprovalStore } from '../../app/approval-store.js'
import { Button } from '../../components/ui/index.js'

/**
 * Asks the reader to allow or refuse one tool call.
 *
 * The runtime holds the call until an answer arrives, so the row is deliberately
 * loud and disappears only after the decision is sent. There is no per-session
 * binding on the wire, which is why this sits beside the composer of whatever
 * conversation is open rather than inside a transcript row.
 */
export function ApprovalCard({
  request,
  foreign = false,
}: {
  request: ApprovalRequest
  /** True when the call belongs to a conversation other than the one on screen. */
  foreign?: boolean
}): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new question replaces the previous one wholesale.
  useEffect(() => {
    setSending(false)
    setError(null)
  }, [request.eventId])

  async function answer(allow: boolean): Promise<void> {
    setSending(true)
    setError(null)
    try {
      await window.pictor.answerApproval(request.eventId, allow)
      useApprovalStore.getState().clear()
    } catch (reason) {
      setSending(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="size-3.5 shrink-0 text-accent" aria-hidden />
        <span className="text-xs text-text">需要你的批准</span>
        {request.tool !== null && (
          <span className="truncate text-2xs text-faint">{request.tool}</span>
        )}
      </div>

      {request.reason !== null && (
        <p className="text-2xs leading-relaxed whitespace-pre-wrap text-muted">{request.reason}</p>
      )}

      {foreign && (
        <p className="text-2xs text-faint">这个请求来自另一个会话，回答之后那边才会继续。</p>
      )}

      {error !== null && <p className="text-2xs text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={sending} onClick={() => void answer(true)}>
          允许一次
        </Button>
        <Button variant="secondary" size="sm" disabled={sending} onClick={() => void answer(false)}>
          拒绝
        </Button>
      </div>
    </div>
  )
}
