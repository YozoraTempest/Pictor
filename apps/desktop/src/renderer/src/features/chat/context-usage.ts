import type { ChatMessage, ChatUsage } from '@pictor/shared'

/** Token counts the provider reported for one turn. */
export type TurnUsage = ChatUsage

/** How much of the window is gone, in bands the UI can colour. */
export type UsageLevel = 'ok' | 'high' | 'full'

export interface UsageSummary {
  /** Tokens the turn used, falling back to input + output when no total came. */
  used: number
  /** Window the model declared, or `null` when nobody declared one. */
  window: number | null
  /** Share of the window, clamped to 1; `null` when the window is unknown. */
  share: number | null
  /** Tokens still available; `null` when the window is unknown. */
  remaining: number | null
  level: UsageLevel
}

/**
 * Fold one turn's usage into the numbers a meter can show.
 *
 * The total is what the provider reported, not a sum of the halves: a provider
 * that counts cached or reasoning tokens differently would make the sum disagree
 * with its own accounting. The window is only used when it was declared, because
 * a share of a guessed denominator is a false statement.
 */
export function usageSummary(
  usage: TurnUsage | undefined,
  window: number | null,
): UsageSummary | null {
  if (usage === undefined || usage === null) return null
  const halves = (usage.input ?? 0) + (usage.output ?? 0)
  const used = usage.total ?? halves
  if (usage.total === null && usage.input === null && usage.output === null) return null

  if (window === null || window <= 0) {
    return { used, window: null, share: null, remaining: null, level: 'ok' }
  }

  const share = Math.min(1, used / window)
  return {
    used,
    window,
    share,
    remaining: Math.max(0, window - used),
    level: share >= 0.9 ? 'full' : share >= 0.7 ? 'high' : 'ok',
  }
}

/**
 * The newest usage a transcript carries.
 *
 * A turn's count is attached to the row its request produced, so the last turn is the
 * last row that has one. Reading it from the transcript is what lets a conversation
 * reopened after a restart still show what it spent, instead of an empty ring.
 */
export function lastUsageOf(messages: readonly ChatMessage[]): TurnUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = messages[index]?.usage
    if (usage !== undefined) return usage
  }
  return null
}

/** One line of the details panel: a label and the count it stands for. */
export interface UsageRow {
  label: string
  tokens: number
}

/** Rows for the details panel, in the order a reader reads them. */
export function usageRows(usage: TurnUsage, summary: UsageSummary): UsageRow[] {
  return [
    ...(usage.input === null ? [] : [{ label: '输入', tokens: usage.input }]),
    ...(usage.output === null ? [] : [{ label: '输出', tokens: usage.output }]),
    { label: '合计', tokens: summary.used },
    ...(summary.remaining === null ? [] : [{ label: '剩余', tokens: summary.remaining }]),
    ...(summary.window === null ? [] : [{ label: '窗口', tokens: summary.window }]),
  ]
}

/** Share as a whole-percent label, or `null` when there is no window to divide by. */
export function sharePercent(share: number | null): string | null {
  if (share === null) return null
  const percent = Math.round(share * 100)
  // Never round a non-zero share down to "0%": that reads as "nothing used".
  return percent === 0 && share > 0 ? '<1%' : `${String(percent)}%`
}
