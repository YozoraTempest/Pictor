import { createHash } from 'node:crypto'

import { z } from 'zod'

import {
  messageSchema,
  runRecordSchema,
  sessionTreeViewSchema,
  toolEventSchema,
  usageSnapshotSchema,
  type RunRecord,
  type SessionRecord,
  type SessionTreeNode,
  type SessionTreeView,
  type ToolEvent,
} from '../../shared/domain.js'
import { classifyRuntimeFailure } from '../../shared/runtime-failure.js'

interface PiEntry {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  message?: unknown
  summary?: unknown
  targetId?: unknown
  label?: unknown
  modelId?: unknown
  thinkingLevel?: unknown
  customType?: unknown
  name?: unknown
  content?: unknown
}

interface PiMessage {
  role?: string
  content?: unknown
  toolCallId?: string
  toolName?: string
  isError?: boolean
  errorMessage?: string
  stopReason?: string
  usage?: unknown
}

const piUsageSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  cost: z.object({ total: z.number().nonnegative() }),
})

export type SessionProjection = Pick<SessionRecord, 'messages' | 'runs' | 'usage'>
export type PiSessionProjection = SessionProjection & { tree: SessionTreeView }

export function projectPiSessionJsonl(
  content: string,
  selectedEntryId?: string | null,
): PiSessionProjection {
  const entries = content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PiEntry)
    .filter((entry) => entry.type !== 'session' && typeof entry.id === 'string')
  const entriesById = new Map(entries.map((entry) => [entry.id!, entry]))
  const branch: PiEntry[] = []
  const activeLeafId = entries.at(-1)?.id ?? null
  const selectedId = selectedEntryId ?? activeLeafId
  if (selectedId && !entriesById.has(selectedId)) {
    throw new Error(`Pi Session entry not found: ${selectedId}`)
  }
  let current = selectedId ? entriesById.get(selectedId) : undefined
  const visited = new Set<string>()
  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id)
    branch.push(current)
    current = current.parentId ? entriesById.get(current.parentId) : undefined
  }
  branch.reverse()

  const messages: SessionRecord['messages'] = []
  const runs: RunRecord[] = []
  const toolsByCallId = new Map<string, ToolEvent>()
  const usageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
    entries: 0,
  }

  for (const entry of branch) {
    if (
      (entry.type === 'compaction' || entry.type === 'branch_summary') &&
      typeof entry.summary === 'string'
    ) {
      const timestamp = entry.timestamp ?? new Date(0).toISOString()
      const summaryKind = entry.type === 'compaction' ? 'Compaction' : 'Branch'
      messages.push(
        messageSchema.parse({
          id: stableUuid(`${entry.type}-message:${entry.id}`),
          role: 'assistant',
          content: `${summaryKind} summary\n\n${entry.summary}`,
          status: 'completed',
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      )
      runs.push(
        runRecordSchema.parse({
          id: stableUuid(`${entry.type}-run:${entry.id}`),
          status: 'completed',
          toolEvents: [],
          error: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      )
      continue
    }
    if (entry.type !== 'message') continue
    const message = asObject(entry.message) as PiMessage | null
    if (!message) continue
    const timestamp = entry.timestamp ?? new Date(0).toISOString()
    if (message.role === 'user') {
      messages.push(
        messageSchema.parse({
          id: stableUuid(`message:${entry.id}`),
          role: 'user',
          content: contentText(message.content),
          status: 'completed',
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      )
      continue
    }
    if (message.role === 'assistant') {
      const usage = piUsageSchema.safeParse(message.usage)
      if (usage.success) {
        usageTotals.input += usage.data.input
        usageTotals.output += usage.data.output
        usageTotals.cacheRead += usage.data.cacheRead
        usageTotals.cacheWrite += usage.data.cacheWrite
        usageTotals.total += usage.data.totalTokens
        usageTotals.cost += usage.data.cost.total
        usageTotals.entries += 1
      }
      const toolEvents = toolCalls(message.content, entry.id!, timestamp)
      const stopped = message.stopReason === 'aborted'
      const failed =
        !stopped && typeof message.errorMessage === 'string' && message.errorMessage.length > 0
      const failure = failed ? classifyRuntimeFailure(message.errorMessage!) : null
      messages.push(
        messageSchema.parse({
          id: stableUuid(`message:${entry.id}`),
          role: 'assistant',
          content: contentText(message.content),
          status: failed ? 'failed' : 'completed',
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      )
      const run = runRecordSchema.parse({
        id: stableUuid(`run:${entry.id}`),
        status: failed ? 'failed' : stopped ? 'stopped' : 'completed',
        toolEvents,
        error: failure?.message ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      runs.push(run)
      for (const tool of run.toolEvents) toolsByCallId.set(tool.callId, tool)
      continue
    }
    if (message.role === 'toolResult' && message.toolCallId) {
      const tool = toolsByCallId.get(message.toolCallId)
      if (!tool) continue
      tool.output = contentText(message.content)
      tool.status = message.isError ? 'failed' : 'completed'
      tool.updatedAt = timestamp
      const run = runs.find((candidate) => candidate.toolEvents.includes(tool))
      if (run) run.updatedAt = timestamp
      if (tool.command) tool.command.approval = message.isError ? 'rejected' : 'allowed'
    }
  }

  return {
    messages,
    runs,
    usage:
      usageTotals.entries > 0
        ? usageSnapshotSchema.parse({
            tokens: {
              input: usageTotals.input,
              output: usageTotals.output,
              cacheRead: usageTotals.cacheRead,
              cacheWrite: usageTotals.cacheWrite,
              total: usageTotals.total,
            },
            cost: usageTotals.cost,
            context: null,
          })
        : null,
    tree: projectTree(entries, entriesById, activeLeafId, selectedId),
  }
}

function projectTree(
  entries: PiEntry[],
  entriesById: Map<string, PiEntry>,
  activeLeafId: string | null,
  selectedEntryId: string | null,
): SessionTreeView {
  const childrenByParent = new Map<string, PiEntry[]>()
  const roots: PiEntry[] = []
  const labels = new Map<string, string>()

  for (const entry of entries) {
    if (entry.type === 'label' && typeof entry.targetId === 'string') {
      if (typeof entry.label === 'string' && entry.label.trim()) {
        labels.set(entry.targetId, entry.label.trim())
      } else {
        labels.delete(entry.targetId)
      }
    }
    if (!entry.parentId || entry.parentId === entry.id || !entriesById.has(entry.parentId)) {
      roots.push(entry)
      continue
    }
    const children = childrenByParent.get(entry.parentId) ?? []
    children.push(entry)
    childrenByParent.set(entry.parentId, children)
  }

  const activePath = collectPathIds(entriesById, activeLeafId)
  const nodes: SessionTreeNode[] = []
  const visited = new Set<string>()
  const stack = sortEntries(roots)
    .toReversed()
    .map((entry) => ({ entry, depth: 0 }))

  while (stack.length > 0) {
    const item = stack.pop()!
    const id = item.entry.id!
    if (visited.has(id)) continue
    visited.add(id)
    const children = sortEntries(childrenByParent.get(id) ?? [])
    nodes.push({
      id,
      parentId: item.entry.parentId ?? null,
      kind: treeNodeKind(item.entry),
      label: labels.get(id) ?? treeNodeLabel(item.entry),
      timestamp: item.entry.timestamp ?? new Date(0).toISOString(),
      depth: item.depth,
      childCount: children.length,
      isActivePath: activePath.has(id),
      isActiveLeaf: id === activeLeafId,
      isSelected: id === selectedEntryId,
    })
    for (const child of children.toReversed()) {
      stack.push({ entry: child, depth: item.depth + 1 })
    }
  }

  for (const entry of entries) {
    if (visited.has(entry.id!)) continue
    nodes.push({
      id: entry.id!,
      parentId: entry.parentId ?? null,
      kind: treeNodeKind(entry),
      label: labels.get(entry.id!) ?? treeNodeLabel(entry),
      timestamp: entry.timestamp ?? new Date(0).toISOString(),
      depth: 0,
      childCount: (childrenByParent.get(entry.id!) ?? []).length,
      isActivePath: activePath.has(entry.id!),
      isActiveLeaf: entry.id === activeLeafId,
      isSelected: entry.id === selectedEntryId,
    })
  }

  return sessionTreeViewSchema.parse({ nodes, activeLeafId, selectedEntryId })
}

function collectPathIds(entriesById: Map<string, PiEntry>, leafId: string | null): Set<string> {
  const path = new Set<string>()
  let current = leafId ? entriesById.get(leafId) : undefined
  while (current?.id && !path.has(current.id)) {
    path.add(current.id)
    current = current.parentId ? entriesById.get(current.parentId) : undefined
  }
  return path
}

function sortEntries(entries: PiEntry[]): PiEntry[] {
  return entries.toSorted(
    (left, right) =>
      Date.parse(left.timestamp ?? '') - Date.parse(right.timestamp ?? '') ||
      String(left.id).localeCompare(String(right.id)),
  )
}

function treeNodeKind(entry: PiEntry): SessionTreeNode['kind'] {
  if (entry.type === 'message') {
    const message = asObject(entry.message) as PiMessage | null
    if (message?.role === 'user') return 'user'
    if (message?.role === 'assistant') return 'assistant'
    if (message?.role === 'toolResult') return 'tool-result'
  }
  const kinds: Record<string, SessionTreeNode['kind']> = {
    compaction: 'compaction',
    branch_summary: 'branch-summary',
    model_change: 'model',
    thinking_level_change: 'thinking',
    custom: 'custom',
    custom_message: 'custom-message',
    label: 'label',
    session_info: 'session-info',
  }
  return kinds[entry.type] ?? 'unknown'
}

function treeNodeLabel(entry: PiEntry): string {
  if (entry.type === 'message') {
    const message = asObject(entry.message) as PiMessage | null
    const text = contentText(message?.content)
    if (text) return truncateLabel(text)
    if (message?.role === 'assistant' && Array.isArray(message.content)) {
      const tools = message.content.flatMap((value) => {
        const block = asObject(value)
        return block?.type === 'toolCall' && typeof block.name === 'string' ? [block.name] : []
      })
      if (tools.length > 0) return `Tool · ${tools.join(', ')}`
    }
    if (message?.role === 'toolResult') return `Tool result · ${message.toolName ?? 'unknown'}`
    return message?.role === 'assistant' ? 'Assistant response' : 'Message'
  }
  if (entry.type === 'compaction') return 'Compaction summary'
  if (entry.type === 'branch_summary') return 'Branch summary'
  if (entry.type === 'model_change') return `Model · ${String(entry.modelId ?? 'unknown')}`
  if (entry.type === 'thinking_level_change') {
    return `Thinking · ${String(entry.thinkingLevel ?? 'unknown')}`
  }
  if (entry.type === 'custom') return `Extension · ${String(entry.customType ?? 'custom')}`
  if (entry.type === 'custom_message') {
    const text = contentText(entry.content)
    return text
      ? truncateLabel(text)
      : `Extension message · ${String(entry.customType ?? 'custom')}`
  }
  if (entry.type === 'label') return `Label · ${String(entry.label ?? 'cleared')}`
  if (entry.type === 'session_info') return `Session · ${String(entry.name ?? 'unnamed')}`
  return entry.type
}

function truncateLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function toolCalls(content: unknown, entryId: string, timestamp: string): ToolEvent[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((value, index) => {
    const block = asObject(value)
    if (!block || block.type !== 'toolCall' || typeof block.id !== 'string') return []
    const name = typeof block.name === 'string' ? block.name : 'extension-tool'
    const args = asObject(block.arguments) ?? {}
    const path = displayPath(args)
    const command =
      name === 'pictor_command' &&
      typeof args.command === 'string' &&
      typeof args.cwd === 'string' &&
      typeof args.purpose === 'string'
        ? {
            command: args.command,
            cwd: args.cwd,
            purpose: args.purpose,
            approval: 'pending' as const,
          }
        : null
    return [
      toolEventSchema.parse({
        id: stableUuid(`tool:${entryId}:${block.id}:${index}`),
        callId: block.id,
        kind: toolKind(name),
        label: path ?? name,
        path,
        command,
        status: 'running',
        output: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]
  })
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((value) => {
      const block = asObject(value)
      if (!block) return []
      if (block.type === 'text' && typeof block.text === 'string') return [block.text]
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        return [`Thinking\n\n${block.thinking}`]
      }
      return []
    })
    .join('\n\n')
}

function displayPath(args: Record<string, unknown>): string | null {
  if (typeof args.path === 'string') return args.path
  if (typeof args.sourcePath === 'string' && typeof args.destinationPath === 'string') {
    return `${args.sourcePath} -> ${args.destinationPath}`
  }
  return null
}

function toolKind(name: string): ToolEvent['kind'] {
  const kinds: Record<string, ToolEvent['kind']> = {
    pictor_list: 'list',
    pictor_search: 'search',
    pictor_read: 'read',
    pictor_write: 'write',
    pictor_edit: 'edit',
    pictor_move: 'move',
    pictor_delete: 'delete',
    pictor_command: 'command',
  }
  return kinds[name] ?? 'custom'
}

function stableUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
