import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

import type { ChatHistoryPage, ChatMessage } from './types.js'

/** Projects Pi JSONL entries into display messages. */
export async function projectSessionFile(path: string): Promise<ChatMessage[]> {
  if (!existsSync(path)) return []

  const messages: ChatMessage[] = []
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  let index = 0
  for await (const line of reader) {
    if (line.trim().length === 0) continue
    index += 1

    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    const message = projectEntry(entry, index)
    if (message !== null) messages.push(message)
  }

  return messages
}

/**
 * Returns the newest `limit` messages before `offset` from the end.
 *
 * Pagination counts from the end because a chat opens at the latest message.
 */
export async function loadHistoryPage(
  path: string,
  limit: number,
  offset: number,
): Promise<ChatHistoryPage> {
  const all = await projectSessionFile(path)
  const end = Math.max(0, all.length - offset)
  const start = Math.max(0, end - limit)
  const messages = all.slice(start, end)

  return {
    messages,
    nextOffset: offset + messages.length,
    hasMore: start > 0,
  }
}

function projectEntry(entry: unknown, index: number): ChatMessage | null {
  if (typeof entry !== 'object' || entry === null) return null

  const record = entry as Record<string, unknown>
  if (record.type !== 'message') return null

  const payload = record.message
  if (typeof payload !== 'object' || payload === null) return null

  const message = payload as Record<string, unknown>
  const role = message.role
  const timestamp = typeof record.timestamp === 'number' ? record.timestamp : null

  if (role === 'user') {
    const text = extractText(message.content)
    return text.length === 0 ? null : { id: `m${index}`, role: 'user', text, timestamp }
  }

  if (role === 'assistant') {
    const text = extractText(message.content)
    return text.length === 0 ? null : { id: `m${index}`, role: 'assistant', text, timestamp }
  }

  if (role === 'toolResult') {
    return {
      id: `m${index}`,
      role: 'tool',
      text: extractText(message.content),
      timestamp,
      toolName: typeof message.toolName === 'string' ? message.toolName : 'tool',
      isError: message.isError === true,
    }
  }

  return null
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
