/** Wall-clock `HH:mm`, or null when the row has no timestamp. */
export function formatClock(timestamp: number | null): string | null {
  if (timestamp === null) return null
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** Compact elapsed time: `8s`, `1m 05s`, `1h 02m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${String(total)}s`

  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    return `${String(minutes)}m ${String(total % 60).padStart(2, '0')}s`
  }

  const hours = Math.floor(minutes / 60)
  return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export type AgentPhase = 'idle' | 'connecting' | 'thinking' | 'tool' | 'writing'

/** Short status line shown next to the agent name while it works. */
export function phaseLabel(phase: AgentPhase, tool: string | null): string {
  switch (phase) {
    case 'connecting':
      return '正在连接 API'
    case 'thinking':
      return '思考中'
    case 'tool':
      return tool === null ? '调用工具' : `调用 ${tool}`
    case 'writing':
      return '正在回复'
    default:
      return '空闲'
  }
}

/**
 * Default title for a conversation the user has not named: the moment it started.
 * Shared so the sidebar, the title bar and a draft all agree on the wording.
 */
export function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * A token count the way a meter shows it: 812, 12.4k, 1.0M.
 *
 * One decimal below 100k, none above: the last digits of a context window are
 * noise, and a meter that jitters because it added 3 tokens is worse than one
 * that reads the same for a while.
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0'
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 100_000) return `${(tokens / 1000).toFixed(1)}k`
  if (tokens < 1_000_000) return `${String(Math.round(tokens / 1000))}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}
