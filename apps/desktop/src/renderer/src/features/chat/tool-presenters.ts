import type { ChatMessage } from '@pictor/shared'

/** One titled block inside an expanded tool call. */
export interface ToolSection {
  title: string
  body: string
}

/**
 * How a tool wants its call to be shown.
 *
 * `label` names the action (`阅读`), `target` names the object it acted on
 * (`README.md`), and `sections` is what the expanded row reveals. Keeping all
 * three on the tool means a new tool can teach the transcript how to present it
 * without touching this component.
 */
export interface ToolPresentation {
  label: string
  target: string
  sections: ToolSection[]
}

export type ToolPresenter = (message: ChatMessage) => ToolPresentation

const presenters = new Map<string, ToolPresenter>()

/** Registers (or replaces) the presenter for one tool. Returns a disposer. */
export function registerToolPresenter(tool: string, presenter: ToolPresenter): () => void {
  presenters.set(tool, presenter)
  return () => {
    if (presenters.get(tool) === presenter) presenters.delete(tool)
  }
}

/** Presentation for a tool call; unknown tools fall back to args + output. */
export function presentTool(message: ChatMessage): ToolPresentation {
  const tool = message.toolName ?? 'tool'
  const presenter = presenters.get(tool)
  if (presenter !== undefined) return presenter(message)
  return fallbackPresentation(message, tool)
}

/** Display name for a tool, used where only the name is known (status line). */
export function toolLabel(tool: string): string {
  const presenter = presenters.get(tool)
  if (presenter === undefined) return tool
  return presenter({ id: '', role: 'tool', text: '', timestamp: null, toolName: tool }).label
}

function fallbackPresentation(message: ChatMessage, tool: string): ToolPresentation {
  const sections: ToolSection[] = []

  if (message.input !== undefined && message.input !== null) {
    sections.push({ title: '入参', body: prettyJson(message.input) })
  }
  if (message.text.length > 0) {
    sections.push({
      title: message.blocked === true ? '拦截原因' : '出参',
      body: message.text,
    })
  }

  return { label: tool, target: '', sections }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function field(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

/** Last path segment, so `src/app/x.ts` reads as `x.ts` in a one-line summary. */
function baseName(path: string): string {
  if (path.length === 0) return ''
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.at(-1) ?? path
}

function clip(text: string, limit = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function prettyJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// --- Built-in presenters -----------------------------------------------------

registerToolPresenter('read', (message) => {
  const args = asRecord(message.input)
  return {
    label: '阅读',
    target: baseName(field(args, 'file_path')),
    sections: [{ title: '文件内容', body: message.text }],
  }
})

registerToolPresenter('write', (message) => {
  const args = asRecord(message.input)
  const written = field(args, 'content')
  return {
    label: '写入',
    target: baseName(field(args, 'file_path')),
    sections: [
      ...(written.length > 0 ? [{ title: '写入内容', body: written }] : []),
      { title: '结果', body: message.text },
    ],
  }
})

registerToolPresenter('edit', (message) => {
  const args = asRecord(message.input)
  const before = field(args, 'old_string')
  const after = field(args, 'new_string')
  return {
    label: '编辑',
    target: baseName(field(args, 'file_path')),
    sections: [
      ...(before.length > 0 ? [{ title: '原内容', body: before }] : []),
      ...(after.length > 0 ? [{ title: '新内容', body: after }] : []),
      { title: '结果', body: message.text },
    ],
  }
})

registerToolPresenter('bash', (message) => {
  const args = asRecord(message.input)
  const command = field(args, 'command')
  return {
    label: '运行',
    target: clip(command),
    sections: [
      ...(command.length > 0 ? [{ title: '执行的命令', body: command }] : []),
      { title: '输出', body: message.text },
    ],
  }
})

registerToolPresenter('grep', (message) => {
  const args = asRecord(message.input)
  return {
    label: '搜索',
    target: clip(field(args, 'pattern')),
    sections: [{ title: '匹配结果', body: message.text }],
  }
})

registerToolPresenter('find', (message) => {
  const args = asRecord(message.input)
  return {
    label: '查找文件',
    target: clip(field(args, 'pattern')),
    sections: [{ title: '匹配结果', body: message.text }],
  }
})

registerToolPresenter('ls', (message) => {
  const args = asRecord(message.input)
  return {
    label: '列目录',
    target: baseName(field(args, 'path')),
    sections: [{ title: '目录内容', body: message.text }],
  }
})
