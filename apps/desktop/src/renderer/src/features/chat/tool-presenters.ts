import {
  FileDiff,
  FilePen,
  FileText,
  FolderSearch,
  Globe,
  ListChecks,
  Presentation,
  Search,
  Terminal,
  type LucideIcon,
} from 'lucide-react'

import type { ChatMessage } from '@pictor/shared'

import { diffLines, formatDiff } from '../../lib/diff.js'

/** One titled block inside an expanded tool call. */
export interface ToolSection {
  title: string
  body: string
  /** How to render the body; `diff` colours the unified +/- lines. */
  format?: 'text' | 'diff'
}

/**
 * How a tool wants its call to be shown.
 *
 * `label` names the action (`阅读`), `target` names the object it acted on
 * (`README.md`), `icon` is the mark the transcript puts next to it, and
 * `sections` is what the expanded row reveals. Keeping all of it on the tool
 * means a new tool can teach the transcript how to present it without touching
 * these components.
 */
export interface ToolPresentation {
  label: string
  target: string
  /** Row icon; a tool without a presenter or an icon falls back to a terminal. */
  icon?: LucideIcon
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
/**
 * Overrides the label and icon of a tool without losing its sections.
 *
 * A plugin contributes presentation, not rendering: its view is layered on top
 * of whatever presenter already exists, so `编辑` keeps its diff while a plugin
 * renames the row.
 */
export function decorateToolPresentation(
  tool: string,
  patch: { label?: string; icon?: LucideIcon },
): () => void {
  const base = presenters.get(tool)
  const presenter: ToolPresenter = (message) => {
    const view = base === undefined ? fallbackPresentation(message, tool) : base(message)
    return {
      ...view,
      ...(patch.label === undefined ? {} : { label: patch.label }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
    }
  }

  registerToolPresenter(tool, presenter)

  // Undoing an override must put the previous presenter back: deleting the entry
  // would drop the built-in one and leave the tool with the generic fallback.
  return () => {
    if (presenters.get(tool) !== presenter) return
    if (base === undefined) presenters.delete(tool)
    else presenters.set(tool, base)
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

/** Path argument: Pi's tools use `path`, older transcripts may carry `file_path`. */
function pathArg(args: Record<string, unknown>): string {
  const path = field(args, 'path')
  return path.length > 0 ? path : field(args, 'file_path')
}

/**
 * The `read` payload arrives wrapped for the model, not for a reader.
 *
 * dsh answers with `<path>…</path><type>file</type><content>…</content>` and a
 * trailer naming the window it returned. The card shows the file; the window is
 * a caption, so it moves to the section title instead of sitting in the text.
 */
function readPayload(text: string): { body: string; range: string | null } {
  const open = text.indexOf('<content>')
  const close = text.lastIndexOf('</content>')
  const inner = open >= 0 && close > open ? text.slice(open + '<content>'.length, close) : text
  const note = /\(Showing lines (\d+)-(\d+) of (\d+)[^)]*\)/.exec(text)
  return {
    // The trailer is the last thing inside the content block, so it is removed
    // with the wrapper rather than by position.
    body: inner
      .replace(/\(Showing lines \d+-\d+ of \d+[^)]*\)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, ''),
    range: note === null ? null : `第 ${note[1]}-${note[2]} 行 / 共 ${note[3]} 行`,
  }
}

registerToolPresenter('read', (message) => {
  const args = asRecord(message.input)
  const payload = readPayload(message.text)
  return {
    label: '阅读',
    icon: FileText,
    target: baseName(pathArg(args)),
    sections: [
      {
        title: payload.range === null ? '文件内容' : `文件内容 · ${payload.range}`,
        body: payload.body,
      },
    ],
  }
})

registerToolPresenter('write', (message) => {
  const args = asRecord(message.input)
  const written = field(args, 'content')
  return {
    label: '写入',
    icon: FilePen,
    target: baseName(pathArg(args)),
    sections: [
      ...(written.length > 0 ? [{ title: '写入内容', body: written }] : []),
      { title: '结果', body: message.text },
    ],
  }
})

registerToolPresenter('edit', (message) => {
  const args = asRecord(message.input)
  // The tool already diffed the real file, so prefer its answer; the arguments
  // are only a fallback for entries that arrive without details.
  const diff = message.diff ?? diffFromArgs(args)

  return {
    label: '编辑',
    icon: FileDiff,
    target: baseName(pathArg(args)),
    sections: [
      ...(diff === undefined ? [] : [{ title: '修改', body: diff, format: 'diff' as const }]),
      { title: '结果', body: message.text },
    ],
  }
})

/**
 * Rebuilds a unified diff from the edit arguments.
 *
 * `edits` is a list of `{oldText,newText}` pairs; a single pair is also accepted
 * directly so hand-written entries still render.
 */
function diffFromArgs(args: Record<string, unknown>): string | undefined {
  const edits = Array.isArray(args.edits) ? args.edits : null
  const pairs =
    edits === null
      ? [{ oldText: field(args, 'old_string'), newText: field(args, 'new_string') }]
      : edits.map((entry) => {
          const record = asRecord(entry)
          return { oldText: field(record, 'oldText'), newText: field(record, 'newText') }
        })

  const rendered = pairs
    .filter((pair) => pair.oldText.length > 0 || pair.newText.length > 0)
    .map((pair) => formatDiff(diffLines(pair.oldText, pair.newText)))

  return rendered.length === 0 ? undefined : rendered.join('\n')
}

registerToolPresenter('bash', (message) => {
  const args = asRecord(message.input)
  const command = field(args, 'command')
  return {
    label: '运行',
    icon: Terminal,
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
    icon: Search,
    target: clip(field(args, 'pattern')),
    sections: [{ title: '匹配结果', body: message.text }],
  }
})

registerToolPresenter('glob', (message) => {
  const args = asRecord(message.input)
  return {
    label: '查找文件',
    icon: FolderSearch,
    target: clip(field(args, 'pattern')),
    sections: [{ title: '匹配结果', body: message.text }],
  }
})

registerToolPresenter('str_replace_editor', (message) => {
  const args = asRecord(message.input)
  const command = field(args, 'command')
  const label =
    command === 'create'
      ? '新建'
      : command === 'insert'
        ? '插入'
        : command === 'view'
          ? '查看'
          : '编辑'
  return {
    label,
    icon: command === 'view' ? FileText : FilePen,
    target: baseName(pathArg(args)),
    sections: [
      ...(message.diff === undefined
        ? []
        : [{ title: '改动', body: message.diff, format: 'diff' as const }]),
      ...(message.text.length === 0 ? [] : [{ title: '结果', body: message.text }]),
    ],
  }
})

registerToolPresenter('todo_write', (message) => {
  const args = asRecord(message.input)
  const todos = Array.isArray(args['todos']) ? args['todos'] : []
  return {
    label: '更新待办',
    icon: ListChecks,
    target: `${String(todos.length)} 项`,
    sections: message.text.length === 0 ? [] : [{ title: '待办清单', body: message.text }],
  }
})

registerToolPresenter('web_search', (message) => {
  const args = asRecord(message.input)
  return {
    label: '联网搜索',
    icon: Globe,
    target: clip(field(args, 'query')),
    sections: [{ title: '搜索结果', body: message.text }],
  }
})

registerToolPresenter('web_fetch', (message) => {
  const args = asRecord(message.input)
  return {
    label: '抓取网页',
    icon: Globe,
    target: clip(field(args, 'url')),
    sections: [{ title: '正文', body: message.text }],
  }
})

registerToolPresenter('present', (message) => {
  const args = asRecord(message.input)
  const title = field(args, 'title')
  return {
    label: '展示',
    icon: Presentation,
    target: clip(title.length > 0 ? title : field(args, 'path')),
    sections: message.text.length === 0 ? [] : [{ title: '内容', body: message.text }],
  }
})
