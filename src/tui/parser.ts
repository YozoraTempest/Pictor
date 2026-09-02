import { z } from 'zod'

export interface ParsedTuiRequest {
  readonly userDataDirectory: string | null
  readonly profile: 'default' | 'developer' | null
  readonly safeMode: boolean
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly nonInteractive: boolean
  readonly tuiMode: 'regular' | 'fullscreen'
  readonly help: boolean
  readonly version: boolean
}

export class TuiUsageError extends Error {
  readonly name = 'TuiUsageError'

  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}

export const TUI_HELP = Object.freeze({
  usage: 'pictor tui [options]',
  options: Object.freeze([
    '--user-data-dir <path>       使用指定的 user-data/profile 目录',
    '--profile <default|developer> 选择 Plugin Profile',
    '--project <path>             定位或注册一个显式项目目录',
    '--session <id>               定位已注册的 Session ID',
    '--safe-mode                  不激活任何 Plugin',
    '--non-interactive            只执行启动/首次使用诊断，不进入 Pi TUI',
    '--tui-mode <regular|fullscreen> 选择 Pi TUI 布局',
    '-h, --help                   显示帮助',
    '-v, --version                显示版本',
  ]),
})

export function formatTuiHelp(): string {
  return [`Usage: ${TUI_HELP.usage}`, '', 'Options:', ...TUI_HELP.options, ''].join('\n')
}

export function parseTuiArgs(arguments_: readonly string[]): ParsedTuiRequest {
  let userDataDirectory: string | null = null
  let profile: ParsedTuiRequest['profile'] = null
  let safeMode = false
  let projectPath: string | null = null
  let sessionId: string | null = null
  let nonInteractive = false
  let tuiMode: ParsedTuiRequest['tuiMode'] = 'regular'
  let tuiModeSpecified = false
  let help = false
  let version = false

  const requireValue = (index: number, flag: string): string => {
    const value = arguments_[index + 1]
    if (!value || value.startsWith('-')) throw new TuiUsageError(`${flag} 缺少参数`, flag)
    return value
  }
  const requireInlineOrNextValue = (
    argument: string,
    index: number,
    flag: string,
  ): { value: string; nextIndex: number } => {
    const inline = argument.includes('=')
    const value = inline ? argument.slice(argument.indexOf('=') + 1) : requireValue(index, flag)
    if (!value) throw new TuiUsageError(`${flag} 缺少参数`, flag)
    return { value, nextIndex: inline ? index : index + 1 }
  }
  const ensureUnset = (current: string | null, flag: string): void => {
    if (current !== null) throw new TuiUsageError(`${flag} 不能重复指定`, flag)
  }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? ''
    if (argument === '-h' || argument === '--help') {
      help = true
      continue
    }
    if (argument === '-v' || argument === '--version') {
      version = true
      continue
    }
    if (argument === '--safe-mode') {
      if (safeMode) throw new TuiUsageError('--safe-mode 不能重复指定', 'safe-mode')
      safeMode = true
      continue
    }
    if (argument === '--non-interactive') {
      if (nonInteractive)
        throw new TuiUsageError('--non-interactive 不能重复指定', 'non-interactive')
      nonInteractive = true
      continue
    }
    if (argument === '--user-data-dir' || argument.startsWith('--user-data-dir=')) {
      const parsed = requireInlineOrNextValue(argument, index, '--user-data-dir')
      index = parsed.nextIndex
      const value = parsed.value
      ensureUnset(userDataDirectory, '--user-data-dir')
      userDataDirectory = value
      continue
    }
    if (argument === '--profile' || argument.startsWith('--profile=')) {
      const parsed = requireInlineOrNextValue(argument, index, '--profile')
      index = parsed.nextIndex
      const value = parsed.value
      ensureUnset(profile, '--profile')
      if (value !== 'default' && value !== 'developer') {
        throw new TuiUsageError('--profile 必须是 default 或 developer', 'profile')
      }
      profile = value
      continue
    }
    if (argument === '--project' || argument.startsWith('--project=')) {
      const parsed = requireInlineOrNextValue(argument, index, '--project')
      index = parsed.nextIndex
      const value = parsed.value
      ensureUnset(projectPath, '--project')
      projectPath = value
      continue
    }
    if (argument === '--session' || argument.startsWith('--session=')) {
      const parsed = requireInlineOrNextValue(argument, index, '--session')
      index = parsed.nextIndex
      const value = parsed.value
      ensureUnset(sessionId, '--session')
      sessionId = value
      continue
    }
    if (argument === '--tui-mode' || argument.startsWith('--tui-mode=')) {
      const parsed = requireInlineOrNextValue(argument, index, '--tui-mode')
      index = parsed.nextIndex
      const value = parsed.value
      if (tuiModeSpecified) throw new TuiUsageError('--tui-mode 不能重复指定', 'tui-mode')
      if (value !== 'regular' && value !== 'fullscreen') {
        throw new TuiUsageError('--tui-mode 必须是 regular 或 fullscreen', 'tui-mode')
      }
      tuiMode = value
      tuiModeSpecified = true
      continue
    }
    throw new TuiUsageError(`无法识别的 TUI 参数：${argument}`)
  }

  if (help && version) throw new TuiUsageError('--help 与 --version 不能同时指定')
  if (sessionId !== null && !z.string().min(1).safeParse(sessionId).success) {
    throw new TuiUsageError('--session 必须是非空 Session ID', 'session')
  }
  return {
    userDataDirectory,
    profile,
    safeMode,
    projectPath,
    sessionId,
    nonInteractive,
    tuiMode,
    help,
    version,
  }
}
