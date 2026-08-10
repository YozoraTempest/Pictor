import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import type { CommandExecutor } from './command-executor.js'
import type { ApprovalBroker, CommandApprovalRequest } from './approval-broker.js'
import type { ProjectPathGuard } from './path-guard.js'

const TEXT_LIMIT = 100_000
const SEARCH_FILE_LIMIT = 500
const SEARCH_MATCH_LIMIT = 500
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out'])

interface ToolDependencies {
  guard: ProjectPathGuard
  approvals: ApprovalBroker
  commandExecutor: CommandExecutor
  isCancelled: () => boolean
  onApprovalResolved: (request: CommandApprovalRequest, allowed: boolean) => void
}

function ensureActive(dependencies: ToolDependencies, signal?: AbortSignal): void {
  signal?.throwIfAborted()
  if (dependencies.isCancelled()) throw new Error('运行已停止，不再开始新的工具操作')
}

function textResult(text: string, details: unknown = undefined) {
  return { content: [{ type: 'text' as const, text }], details }
}

function bounded(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n[内容已截断]` : text
}

async function assertFile(path: string): Promise<void> {
  if (!(await stat(path)).isFile()) throw new Error('目标路径不是文件')
}

async function assertDirectory(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new Error('目标路径不是目录')
}

export function createPictorTools(dependencies: ToolDependencies): ToolDefinition[] {
  const list = defineTool({
    name: 'pictor_list',
    label: '列出文件',
    description: '列出项目目录内指定路径的直接子项。路径必须位于项目根目录内。',
    parameters: Type.Object({ path: Type.Optional(Type.String({ default: '.' })) }),
    async execute(_callId, params, signal) {
      ensureActive(dependencies, signal)
      const target = await dependencies.guard.resolveExisting(params.path ?? '.')
      await assertDirectory(target)
      const entries = (await readdir(target, { withFileTypes: true })).slice(0, 500)
      const output = entries
        .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
        .join('\n')
      return textResult(output || '(空目录)', {
        path: dependencies.guard.toRelative(target),
        count: entries.length,
      })
    },
  })

  const read = defineTool({
    name: 'pictor_read',
    label: '读取文件',
    description: '读取项目内文本文件，可按行号截取。',
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
      lineCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    }),
    async execute(_callId, params, signal) {
      ensureActive(dependencies, signal)
      const target = await dependencies.guard.resolveExisting(params.path)
      await assertFile(target)
      const content = await readFile(target, 'utf8')
      const start = (params.startLine ?? 1) - 1
      const selected = content.split(/\r?\n/).slice(start, start + (params.lineCount ?? 5000))
      return textResult(bounded(selected.join('\n')), {
        path: dependencies.guard.toRelative(target),
        startLine: start + 1,
        lines: selected.length,
      })
    },
  })

  const search = defineTool({
    name: 'pictor_search',
    label: '搜索项目',
    description: '在项目内文本文件中按不区分大小写的字面文本搜索。',
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      path: Type.Optional(Type.String({ default: '.' })),
    }),
    async execute(_callId, params, signal) {
      ensureActive(dependencies, signal)
      const root = await dependencies.guard.resolveExisting(params.path ?? '.')
      const matches: string[] = []
      let scannedFiles = 0

      async function walk(directory: string): Promise<void> {
        ensureActive(dependencies, signal)
        if (scannedFiles >= SEARCH_FILE_LIMIT || matches.length >= SEARCH_MATCH_LIMIT) return
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (matches.length >= SEARCH_MATCH_LIMIT) break
          if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
          const candidate = join(directory, entry.name)
          let guarded: string
          try {
            guarded = await dependencies.guard.resolveExisting(candidate)
          } catch {
            continue
          }
          if (entry.isDirectory()) {
            await walk(guarded)
            continue
          }
          if (!entry.isFile() || scannedFiles++ >= SEARCH_FILE_LIMIT) continue
          const content = await readFile(guarded, 'utf8').catch(() => '')
          const needle = params.query.toLocaleLowerCase('en-US')
          content.split(/\r?\n/).forEach((line, index) => {
            if (
              matches.length < SEARCH_MATCH_LIMIT &&
              line.toLocaleLowerCase('en-US').includes(needle)
            ) {
              matches.push(`${dependencies.guard.toRelative(guarded)}:${index + 1}: ${line}`)
            }
          })
        }
      }

      await assertDirectory(root)
      await walk(root)
      return textResult(bounded(matches.join('\n') || '未找到匹配项'), {
        path: dependencies.guard.toRelative(root),
        scannedFiles,
        matches: matches.length,
      })
    },
  })

  const write = defineTool({
    name: 'pictor_write',
    label: '写入文件',
    description: '在项目内创建或完整覆盖文本文件。',
    executionMode: 'sequential',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(_callId, params, signal) {
      ensureActive(dependencies, signal)
      const target = await dependencies.guard.resolveForWrite(params.path)
      await mkdir(dirname(target), { recursive: true })
      ensureActive(dependencies, signal)
      await writeFile(target, params.content, 'utf8')
      return textResult(`已写入 ${dependencies.guard.toRelative(target)}`, {
        path: dependencies.guard.toRelative(target),
        bytes: Buffer.byteLength(params.content),
      })
    },
  })

  const edit = defineTool({
    name: 'pictor_edit',
    label: '编辑文件',
    description: '在项目内文本文件中进行一次精确文本替换。',
    executionMode: 'sequential',
    parameters: Type.Object({
      path: Type.String(),
      oldText: Type.String({ minLength: 1 }),
      newText: Type.String(),
    }),
    async execute(_callId, params, signal) {
      ensureActive(dependencies, signal)
      const target = await dependencies.guard.resolveExisting(params.path)
      await assertFile(target)
      const content = await readFile(target, 'utf8')
      const occurrences = content.split(params.oldText).length - 1
      if (occurrences === 0) throw new Error('未找到要替换的原文本')
      if (occurrences > 1) throw new Error('原文本出现多次，请提供更精确的上下文')
      ensureActive(dependencies, signal)
      await writeFile(target, content.replace(params.oldText, params.newText), 'utf8')
      return textResult(`已编辑 ${dependencies.guard.toRelative(target)}`, {
        path: dependencies.guard.toRelative(target),
      })
    },
  })

  const command = defineTool({
    name: 'pictor_command',
    label: '执行命令',
    description: '请求用户批准后，在项目内的 Git Bash 工作目录执行一条命令。',
    executionMode: 'sequential',
    parameters: Type.Object({
      command: Type.String({ minLength: 1 }),
      cwd: Type.Optional(Type.String({ default: '.' })),
      purpose: Type.String({ minLength: 1 }),
    }),
    async execute(callId, params, signal) {
      ensureActive(dependencies, signal)
      const cwd = await dependencies.guard.resolveExisting(params.cwd ?? '.')
      await assertDirectory(cwd)
      const request = { callId, command: params.command, cwd, purpose: params.purpose }
      const allowed = await dependencies.approvals.request(request, signal)
      dependencies.onApprovalResolved(request, allowed)
      if (!allowed) throw new Error('命令已被用户拒绝，未执行')
      ensureActive(dependencies, signal)
      const result = await dependencies.commandExecutor.execute(params.command, cwd, signal)
      const output = [
        `exit: ${result.exitCode ?? 'terminated'}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      if (result.exitCode !== 0) throw new Error(bounded(output))
      return textResult(bounded(output), result)
    },
  })

  return [list, search, read, write, edit, command]
}
