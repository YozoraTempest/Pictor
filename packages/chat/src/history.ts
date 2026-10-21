import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

import { isBlockedReason, stripBlockedPrefix } from '@pictor/shared'

import { readToolDiff, type ChatHistoryPage, type ChatMessage } from './types.js'

/** Projects Pi JSONL entries into display messages. */
export async function projectSessionFile(path: string): Promise<ChatMessage[]> {
  if (!existsSync(path)) return []

  const entries: unknown[] = []
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  for await (const line of reader) {
    if (line.trim().length === 0) continue
    try {
      entries.push(JSON.parse(line) as unknown)
    } catch {
      // A truncated last line is normal after a crash; skip it and keep the rest.
    }
  }

  // Tool calls and their results are separate entries linked by id, so the
  // arguments have to be collected first: a `toolResult` alone has no input.
  const calls = collectToolCalls(entries)
  const messages: ChatMessage[] = []

  entries.forEach((entry, position) => {
    messages.push(...projectEntry(entry, position + 1, calls))
  })

  return messages
}

interface ToolCall {
  name: string
  input: unknown
}

function collectToolCalls(entries: readonly unknown[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>()

  for (const entry of entries) {
    const message = messageOf(entry)
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (typeof block !== 'object' || block === null) continue
      const record = block as Record<string, unknown>
      if (record.type !== 'toolCall' || typeof record.id !== 'string') continue

      calls.set(record.id, {
        name: typeof record.name === 'string' ? record.name : 'tool',
        input: record.arguments ?? null,
      })
    }
  }

  return calls
}

function messageOf(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  if (record.type !== 'message') return null

  const payload = record.message
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null
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

function projectEntry(
  entry: unknown,
  index: number,
  calls: ReadonlyMap<string, ToolCall>,
): ChatMessage[] {
  if (typeof entry !== 'object' || entry === null) return []

  const record = entry as Record<string, unknown>
  if (record.type !== 'message') return []

  const payload = record.message
  if (typeof payload !== 'object' || payload === null) return []

  const message = payload as Record<string, unknown>
  const role = message.role
  const timestamp = typeof record.timestamp === 'number' ? record.timestamp : null

  if (role === 'user') {
    const text = extractText(message.content)
    return text.length === 0 ? [] : [{ id: `m${index}`, role: 'user', text, timestamp }]
  }

  if (role === 'assistant') {
    // Reasoning is stored next to the answer. Keeping the blocks apart is what
    // lets the transcript collapse it once the run is over instead of blending
    // it into the reply.
    const blocks = readBlocks(message.content)

    return blocks.map((block, blockIndex) => ({
      id: blocks.length === 1 ? `m${index}` : `m${index}-${blockIndex}`,
      role: 'assistant' as const,
      text: block.text,
      timestamp,
      ...(block.kind === 'thinking' ? { kind: 'thinking' as const } : {}),
    }))
  }

  if (role === 'toolResult') {
    const text = extractText(message.content)
    // A guard denial is recorded by Pi as an ordinary tool failure; the marker in
    // the reason is the only thing that survives a reload, so it decides whether
    // the row reads 已拦截 or 失败.
    const blocked = isBlockedReason(text)
    const call = typeof message.toolCallId === 'string' ? calls.get(message.toolCallId) : undefined
    const diff = readToolDiff(message.details)

    return [
      {
        id: `m${index}`,
        role: 'tool',
        text: blocked ? stripBlockedPrefix(text) : text,
        timestamp,
        toolName: typeof message.toolName === 'string' ? message.toolName : (call?.name ?? 'tool'),
        isError: message.isError === true,
        ...(blocked ? { blocked: true } : {}),
        ...(call === undefined ? {} : { input: call.input }),
        ...(diff === undefined ? {} : { diff }),
      },
    ]
  }

  return []
}

/** Splits an assistant message into its reasoning and answer blocks, in order. */
function readBlocks(content: unknown): Array<{ kind: 'text' | 'thinking'; text: string }> {
  if (typeof content === 'string') {
    return content.trim().length === 0 ? [] : [{ kind: 'text', text: content.trim() }]
  }
  if (!Array.isArray(content)) return []

  const blocks: Array<{ kind: 'text' | 'thinking'; text: string }> = []
  for (const block of content) {
    if (typeof block === 'string') {
      if (block.trim().length > 0) blocks.push({ kind: 'text', text: block.trim() })
      continue
    }
    if (typeof block !== 'object' || block === null) continue

    const record = block as Record<string, unknown>
    if (
      record.type === 'text' &&
      typeof record.text === 'string' &&
      record.text.trim().length > 0
    ) {
      blocks.push({ kind: 'text', text: record.text.trim() })
      continue
    }
    if (
      record.type === 'thinking' &&
      typeof record.thinking === 'string' &&
      record.thinking.trim().length > 0
    ) {
      blocks.push({ kind: 'thinking', text: record.thinking.trim() })
    }
  }

  return blocks
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
