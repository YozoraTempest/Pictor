const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact relative time such as `3 分钟前` for session rows. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp)

  if (delta < MINUTE) return '刚刚'
  if (delta < HOUR) return `${String(Math.floor(delta / MINUTE))} 分钟前`
  if (delta < DAY) return `${String(Math.floor(delta / HOUR))} 小时前`
  if (delta < 7 * DAY) return `${String(Math.floor(delta / DAY))} 天前`

  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
