const MAX_DIAGNOSTIC_LENGTH = 500

/** Keep host and command diagnostics useful without exposing local paths. */
export function sanitizeGuiDiagnostic(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message.trim()) return fallback

  return message
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, '<local path>')
    .replace(
      /(?<![\w:])\/(?:Users|home|private|tmp|var|opt|workspace)(?:\/[^\s"'`<>]*)*/g,
      '<local path>',
    )
    .slice(0, MAX_DIAGNOSTIC_LENGTH)
}

export function safePluginSource(source: string): string {
  const separator = source.indexOf(':')
  const kind = separator >= 0 ? source.slice(0, separator) : source
  return kind === 'bundled'
    ? 'Bundled'
    : kind === 'development'
      ? 'Development'
      : kind === 'local'
        ? 'Local'
        : kind
}
