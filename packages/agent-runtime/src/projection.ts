import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

export interface ProjectedMessage {
  role: 'user' | 'assistant' | 'tool'
  text: string
  timestamp: number | null
}

/**
 * Rebuilds display messages from Pi JSONL.
 *
 * Pi JSONL stays the single source of truth: this function only projects it and
 * never writes a second history.
 */
export async function projectSession(filePath: string): Promise<ProjectedMessage[]> {
  if (!existsSync(filePath)) return []

  const messages: ProjectedMessage[] = []
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  for await (const line of reader) {
    if (line.trim().length === 0) continue

    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    const message = extractMessage(entry)
    if (message !== null) messages.push(message)
  }

  return messages
}

function extractMessage(entry: unknown): ProjectedMessage | null {
  if (typeof entry !== 'object' || entry === null) return null

  const record = entry as Record<string, unknown>
  const timestamp = typeof record.timestamp === 'number' ? record.timestamp : null
  const payload = record.message
  if (typeof payload !== 'object' || payload === null) return null

  const message = payload as Record<string, unknown>
  const role = message.role
  if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') return null

  const text = extractText(message.content)
  if (text.length === 0) return null

  return {
    role: role === 'toolResult' ? 'tool' : role,
    text,
    timestamp,
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (typeof block !== 'object' || block === null) continue

    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text)
    }
  }

  return parts.join('\n').trim()
}
