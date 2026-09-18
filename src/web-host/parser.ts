import { z } from 'zod'

export interface ParsedWebRequest {
  readonly userDataDirectory: string | null
  readonly profile: 'default' | 'developer'
  readonly safeMode: boolean
  readonly port: number
  readonly openBrowser: boolean
  readonly development: boolean
}

export class WebUsageError extends Error {
  readonly name = 'WebUsageError'
}

export function parseWebArgs(arguments_: readonly string[]): ParsedWebRequest {
  let userDataDirectory: string | null = null
  let profile: ParsedWebRequest['profile'] = 'default'
  let profileSpecified = false
  let safeMode = false
  let port = 0
  let portSpecified = false
  let openBrowser = true
  let development = false

  const readValue = (argument: string, index: number, flag: string) => {
    const inline = argument.startsWith(`${flag}=`)
    const value = inline ? argument.slice(flag.length + 1) : arguments_[index + 1]
    if (!value || value.startsWith('-')) throw new WebUsageError(`${flag} 缺少参数`)
    return { value, nextIndex: inline ? index : index + 1 }
  }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? ''
    if (argument === '--safe-mode') {
      if (safeMode) throw new WebUsageError('--safe-mode 不能重复指定')
      safeMode = true
      continue
    }
    if (argument === '--no-open') {
      if (!openBrowser) throw new WebUsageError('--no-open 不能重复指定')
      openBrowser = false
      continue
    }
    if (argument === '--development') {
      if (development) throw new WebUsageError('--development 不能重复指定')
      development = true
      continue
    }
    if (argument === '--user-data-dir' || argument.startsWith('--user-data-dir=')) {
      if (userDataDirectory !== null) throw new WebUsageError('--user-data-dir 不能重复指定')
      const parsed = readValue(argument, index, '--user-data-dir')
      userDataDirectory = parsed.value
      index = parsed.nextIndex
      continue
    }
    if (argument === '--profile' || argument.startsWith('--profile=')) {
      if (profileSpecified) throw new WebUsageError('--profile 不能重复指定')
      const parsed = readValue(argument, index, '--profile')
      if (parsed.value !== 'default' && parsed.value !== 'developer') {
        throw new WebUsageError('--profile 必须是 default 或 developer')
      }
      profile = parsed.value
      profileSpecified = true
      index = parsed.nextIndex
      continue
    }
    if (argument === '--port' || argument.startsWith('--port=')) {
      if (portSpecified) throw new WebUsageError('--port 不能重复指定')
      const parsed = readValue(argument, index, '--port')
      const parsedPort = z.coerce.number().int().min(0).max(65_535).safeParse(parsed.value)
      if (!parsedPort.success) throw new WebUsageError('--port 必须是 0 到 65535 的整数')
      port = parsedPort.data
      portSpecified = true
      index = parsed.nextIndex
      continue
    }
    throw new WebUsageError(`无法识别的 Web Host 参数：${argument}`)
  }

  return { userDataDirectory, profile, safeMode, port, openBrowser, development }
}
