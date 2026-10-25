#!/usr/bin/env node
/**
 * Drives one kernel with one prompt and prints what it reported.
 *
 * This is the research half of the multi-kernel work: before any of it reaches
 * the app, the same prompt has to be runnable against Codex, Pi and dsh with the
 * answers side by side. The adapters here are the prospective `KernelDriver`
 * implementations, so what they print is exactly what the app would render.
 *
 *   node scripts/kernel-probe.mjs --kernel codex "列出当前目录"
 *   node scripts/kernel-probe.mjs --kernel pi --cwd /tmp --json "..."
 *   node scripts/kernel-probe.mjs --list
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { codexKernel } from './kernels/codex.mjs'
import { piKernel } from './kernels/pi.mjs'

/** Kernels this probe can drive today. dsh goes through Pictor's own service. */
const KERNELS = new Map([
  [codexKernel.id, codexKernel],
  [piKernel.id, piKernel],
])

/** Where each CLI is expected to be, so a missing one is reported as such. */
const BINARIES = { codex: 'codex', pi: 'pi' }

function parseArgs(argv) {
  const options = { kernel: 'codex', cwd: process.cwd(), json: false, list: false, prompt: null }
  const rest = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') {
      options.list = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--kernel' || arg === '--cwd' || arg === '--session') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} 需要一个值`)
      if (arg === '--kernel') options.kernel = value
      if (arg === '--cwd') options.cwd = resolve(value)
      if (arg === '--session') options.session = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    rest.push(arg)
  }

  options.prompt = rest.join(' ').trim()
  return options
}

/** One line per event, so two kernels can be compared by eye. */
function describe(event) {
  switch (event.type) {
    case 'run.started':
      return `▶ 开始  session=${event.sessionId ?? '新会话'}`
    case 'text.delta':
      return `  文本  ${JSON.stringify(event.text)}`
    case 'thinking.delta':
      return `  思考  ${JSON.stringify(event.text)}`
    case 'tool.start':
      return `  工具▸ ${event.tool} ${JSON.stringify(event.input).slice(0, 120)}`
    case 'tool.finished': {
      const head = event.output.replace(/\s+/g, ' ').slice(0, 120)
      return `  工具◂ ${event.isError ? '失败' : '完成'} ${JSON.stringify(head)}`
    }
    case 'usage':
      return `  用量  输入 ${event.input ?? '?'} / 输出 ${event.output ?? '?'} / 合计 ${event.total ?? '?'}`
    case 'run.finished':
      return `■ 结束  ${event.ok ? '成功' : `失败：${event.error ?? ''}`}`
    case 'notice':
      return `! 提示  ${event.message}`
    default:
      return `? 未知  ${JSON.stringify(event)}`
  }
}

function usage() {
  return [
    '用法：node scripts/kernel-probe.mjs [--kernel codex|pi] [--cwd DIR] [--json] [--session ID] "提示词"',
    '',
    '  --kernel   要驱动的内核（默认 codex）',
    '  --cwd      工作目录（默认当前目录）',
    '  --json     打印统一事件原始 JSON，而不是人读格式',
    '  --session  续接已有会话 id',
    '  --list     列出可用内核与各自能力',
  ].join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help === true) {
    console.log(usage())
    return 0
  }

  if (options.list === true) {
    for (const kernel of KERNELS.values()) {
      const present =
        existsSync(`${homedir()}/.local/bin/${kernel.id}`) || BINARIES[kernel.id] === 'pi'
      const on = Object.entries(kernel.capabilities)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .join(' ')
      console.log(
        `${kernel.id.padEnd(6)} ${kernel.label.padEnd(10)} ${present ? '' : '(未检测到)'}`,
      )
      console.log(`       能力：${on}`)
    }
    console.log('\n注：dsh 由 Pictor 主进程自己的 HarnessService 驱动，不在本探针内。')
    return 0
  }

  const kernel = KERNELS.get(options.kernel)
  if (kernel === undefined) {
    console.error(`未知内核：${options.kernel}。可用：${[...KERNELS.keys()].join(', ')}`)
    return 2
  }
  if (options.prompt.length === 0) {
    console.error('缺少提示词。\n')
    console.error(usage())
    return 2
  }
  if (!existsSync(options.cwd)) {
    console.error(`工作目录不存在：${options.cwd}`)
    return 2
  }

  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.once('SIGINT', onSigint)

  const started = Date.now()
  const counts = { text: 0, thinking: 0, tools: 0, usage: null }

  const result = await kernel.run({
    prompt: options.prompt,
    cwd: options.cwd,
    sessionId: options.session ?? null,
    model: null,
    signal: controller.signal,
    onEvent: (event) => {
      if (event.type === 'text.delta') counts.text += event.text.length
      if (event.type === 'thinking.delta') counts.thinking += event.text.length
      if (event.type === 'tool.start') counts.tools += 1
      if (event.type === 'usage') counts.usage = event
      if (options.json) console.log(JSON.stringify(event))
      else console.log(describe(event))
    },
  })

  process.off('SIGINT', onSigint)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `\n—— ${kernel.label}：${result.ok ? '成功' : '失败'}，${seconds}s，` +
      `文本 ${String(counts.text)} 字，思考 ${String(counts.thinking)} 字，工具 ${String(counts.tools)} 次` +
      (counts.usage === null ? '' : `，用量 ${String(counts.usage.total ?? '?')} tokens`) +
      (result.sessionId === null ? '' : `，会话 ${result.sessionId}`),
  )
  return result.ok ? 0 : 1
}

process.exitCode = await main()
