const MAX_DIAGNOSTIC_LENGTH = 500
const LOCAL_PATH = '<local path>'

const fileUrlPattern = /\bfile:\/\/(?:localhost)?(?:\/[^\s"'`<>)]*|[A-Za-z]:[\\/][^\s"'`<>)]*)/gi
const windowsPathPattern = /\b[A-Za-z]:[\\/][^\s"'`<>)]*/g
const posixPathPattern = /(^|[^\w:/])\/(?![/\s])[^\s"'`<>)]*/g

/** Keep host and command diagnostics useful without exposing local paths. */
export function sanitizeGuiDiagnostic(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message.trim()) return fallback

  return message
    .replace(fileUrlPattern, LOCAL_PATH)
    .replace(windowsPathPattern, LOCAL_PATH)
    .replace(posixPathPattern, (_match, prefix: string) => `${prefix}${LOCAL_PATH}`)
    .slice(0, MAX_DIAGNOSTIC_LENGTH)
}

export function safePluginSource(source: string): string {
  const kind = source.trim().split(':', 1)[0]?.toLowerCase()
  if (kind === 'bundled') return 'Bundled'
  if (kind === 'development') return 'Development'
  if (kind === 'local') return 'Local'
  return 'External'
}
