import { z } from 'zod'

import {
  pluginIdentitySchema,
  pluginInstallRequestSchema,
  pluginRemoveRequestSchema,
  pluginRestoreRequestSchema,
} from '../commands/core.js'

import type {
  CliOutputFormat,
  CliPluginProfile,
  ParsedCliCommand,
  ParsedCliRequest,
} from './contract.js'

export class CliUsageError extends Error {
  readonly name = 'CliUsageError'

  constructor(
    message: string,
    readonly output: CliOutputFormat = 'text',
    readonly field?: string,
  ) {
    super(message)
  }
}

interface GlobalOptions {
  output: CliOutputFormat
  userDataDirectory: string | null
  profile: CliPluginProfile | null
  safeMode: boolean
  help: boolean
  version: boolean
  remaining: string[]
}

const pluginSourceSchema = z.enum([
  'local',
  'development',
  'pi-extension',
  'pi-package',
  'pi-package-spec',
])

export function parseCliArgs(arguments_: readonly string[]): ParsedCliRequest {
  const global = parseGlobalOptions(arguments_)
  const fail = (message: string, field?: string): never => {
    throw new CliUsageError(message, global.output, field)
  }

  if (global.version) {
    if (global.help || global.remaining.length > 0) {
      fail('--version 不能与其它命令或 --help 同时使用')
    }
    return {
      output: global.output,
      userDataDirectory: global.userDataDirectory,
      profile: global.profile,
      safeMode: global.safeMode,
      request: { kind: 'version' },
    }
  }

  if (global.help) {
    return {
      output: global.output,
      userDataDirectory: global.userDataDirectory,
      profile: global.profile,
      safeMode: global.safeMode,
      request: { kind: 'help', topic: global.remaining },
    }
  }

  const [command, ...tokens] = global.remaining
  if (!command) return fail('缺少命令；使用 --help 查看用法')

  if (command === 'help') {
    return {
      output: global.output,
      userDataDirectory: global.userDataDirectory,
      profile: global.profile,
      safeMode: global.safeMode,
      request: { kind: 'help', topic: tokens },
    }
  }

  if (command === 'version') {
    if (tokens.length > 0) fail('version 不接受其它参数')
    return {
      output: global.output,
      userDataDirectory: global.userDataDirectory,
      profile: global.profile,
      safeMode: global.safeMode,
      request: { kind: 'version' },
    }
  }

  if (command === 'doctor') {
    if (tokens.length > 0) fail('doctor 不接受其它参数')
    return createCommandRequest(global, 'app.doctor', null)
  }

  if (command !== 'plugin' && command !== 'ui') {
    return fail(`未知命令：${command}`)
  }

  const [subcommand, ...subcommandTokens] = tokens
  if (!subcommand) return fail(`${command} 缺少子命令`)

  if (subcommand === 'list') {
    if (subcommandTokens.length > 0) fail(`${command} list 不接受其它参数`)
    return createCommandRequest(global, 'plugin.list', null)
  }

  if (subcommand === 'install') {
    return createCommandRequest(global, 'plugin.install', parseInstallInput(subcommandTokens, fail))
  }

  if (subcommand === 'enable' || subcommand === 'disable') {
    const identity = parseIdentityInput(subcommandTokens, fail)
    return createCommandRequest(global, `plugin.${subcommand}`, identity)
  }

  if (subcommand === 'remove') {
    if (command === 'ui') {
      fail('ui 不支持 remove；plugin remove 才是受支持的命令')
    }
    const { options, positional } = parseOptions(
      subcommandTokens,
      new Set(['kind', 'id']),
      new Set(['delete-data']),
      fail,
    )
    if (positional.length > 0) fail('Plugin 身份必须通过 --kind 和 --id 显式指定')
    try {
      return createCommandRequest(
        global,
        'plugin.remove',
        pluginRemoveRequestSchema.parse({
          kind: options.kind,
          id: options.id,
          deleteData: options['delete-data'] === 'true',
        }),
      )
    } catch (error) {
      throw schemaUsageError(error, fail, 'Plugin remove 参数无效')
    }
  }

  if (subcommand === 'restore') {
    const input = parseRestoreInput(subcommandTokens, fail)
    return createCommandRequest(global, 'plugin.restore', input)
  }

  return fail(`未知子命令：${command} ${subcommand}`)
}

function parseGlobalOptions(arguments_: readonly string[]): GlobalOptions {
  let output: CliOutputFormat = 'text'
  let userDataDirectory: string | null = null
  let profile: CliPluginProfile | null = null
  let safeMode = false
  let help = false
  let version = false
  const remaining: string[] = []

  const fail = (message: string, field?: string): never => {
    throw new CliUsageError(message, output, field)
  }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === undefined) continue

    if (argument === '--') {
      remaining.push(...arguments_.slice(index + 1))
      break
    }
    if (!argument.startsWith('-')) {
      remaining.push(argument)
      continue
    }

    if (argument === '--json' || argument === '-j') {
      if (output === 'json') fail('--json 不能重复指定')
      output = 'json'
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--version' || argument === '-v') {
      version = true
      continue
    }
    if (argument === '--safe-mode') {
      if (safeMode) fail('--safe-mode 不能重复指定')
      safeMode = true
      continue
    }

    const [name, inlineValue] = splitOption(argument)
    if (name === '--output') {
      const value = inlineValue ?? takeValue(arguments_, index, fail, name)
      if (inlineValue === undefined) index += 1
      if (value !== 'text' && value !== 'json') fail('--output 必须是 text 或 json')
      if (output !== 'text') fail('--output 不能与 --json 同时指定')
      output = value === 'json' ? 'json' : 'text'
      continue
    }
    if (name === '--user-data-dir') {
      const value = inlineValue ?? takeValue(arguments_, index, fail, name)
      if (inlineValue === undefined) index += 1
      if (userDataDirectory !== null) fail('--user-data-dir 不能重复指定')
      if (!value.trim()) fail('--user-data-dir 不能为空', 'user-data-dir')
      userDataDirectory = value
      continue
    }
    if (name === '--profile') {
      const value = inlineValue ?? takeValue(arguments_, index, fail, name)
      if (inlineValue === undefined) index += 1
      if (profile !== null) fail('--profile 不能重复指定')
      if (value !== 'default' && value !== 'developer') {
        fail('--profile 必须是 default 或 developer', 'profile')
      }
      profile = value === 'developer' ? 'developer' : 'default'
      continue
    }

    remaining.push(argument)
  }

  return { output, userDataDirectory, profile, safeMode, help, version, remaining }
}

function splitOption(argument: string): [string, string | undefined] {
  const separator = argument.indexOf('=')
  if (separator < 0) return [argument, undefined]
  return [argument.slice(0, separator), argument.slice(separator + 1)]
}

function takeValue(
  arguments_: readonly string[],
  index: number,
  fail: (message: string, field?: string) => never,
  option: string,
): string {
  const value = arguments_[index + 1]
  if (value === undefined || value.startsWith('-')) fail(`${option} 缺少参数`)
  return value
}

function parseInstallInput(
  tokens: readonly string[],
  fail: (message: string, field?: string) => never,
): unknown {
  const { options, positional } = parseOptions(
    tokens,
    new Set(['source', 'path', 'spec']),
    new Set(),
    fail,
  )
  if (positional.length > 1 || (options.source !== undefined && positional.length > 0)) {
    fail('plugin install 只接受一个来源位置参数')
  }

  const sourceValue = options.source ?? positional[0]
  if (!sourceValue) fail('plugin install 需要 --source <source>')
  const source = pluginSourceSchema.safeParse(sourceValue)
  if (!source.success) fail('plugin install 的 source 无效', 'source')

  const pathSources = new Set(['local', 'development', 'pi-extension', 'pi-package'])
  if (pathSources.has(source.data)) {
    if (options.path === undefined) fail(`source ${source.data} 需要 --path`, 'path')
    if (options.spec !== undefined) fail(`source ${source.data} 不接受 --spec`, 'spec')
  } else {
    if (options.spec === undefined) fail('source pi-package-spec 需要 --spec', 'spec')
    if (options.path !== undefined) fail('source pi-package-spec 不接受 --path', 'path')
  }

  const candidate = {
    source: source.data,
    ...(options.path !== undefined ? { path: options.path } : {}),
    ...(options.spec !== undefined ? { spec: options.spec } : {}),
  }
  try {
    return pluginInstallRequestSchema.parse(candidate)
  } catch (error) {
    throw schemaUsageError(error, fail, 'plugin install 参数无效')
  }
}

function parseIdentityInput(
  tokens: readonly string[],
  fail: (message: string, field?: string) => never,
): unknown {
  const { options, positional } = parseOptions(tokens, new Set(['kind', 'id']), new Set(), fail)
  if (positional.length > 0) fail('Plugin 身份必须通过 --kind 和 --id 显式指定')
  try {
    return pluginIdentitySchema.parse({ kind: options.kind, id: options.id })
  } catch (error) {
    throw schemaUsageError(error, fail, 'Plugin 身份参数无效')
  }
}

function parseRestoreInput(
  tokens: readonly string[],
  fail: (message: string, field?: string) => never,
): unknown {
  const { options, positional } = parseOptions(tokens, new Set(['id']), new Set(), fail)
  if (positional.length > 0) fail('Plugin 标识必须通过 --id 显式指定')
  try {
    return pluginRestoreRequestSchema.parse({ id: options.id })
  } catch (error) {
    throw schemaUsageError(error, fail, 'Plugin restore 参数无效')
  }
}

function parseOptions(
  tokens: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string>,
  fail: (message: string, field?: string) => never,
): { options: Record<string, string>; positional: string[] } {
  const options: Record<string, string> = {}
  const positional: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    if (!token.startsWith('-')) {
      positional.push(token)
      continue
    }
    const [rawName, inlineValue] = splitOption(token)
    const name = rawName.replace(/^--/, '')
    if (!valueOptions.has(name) && !flagOptions.has(name)) fail(`未知选项：${rawName}`)
    if (options[name] !== undefined) fail(`选项 --${name} 不能重复指定`, name)
    if (flagOptions.has(name)) {
      if (inlineValue !== undefined) fail(`选项 --${name} 不接受参数`, name)
      options[name] = 'true'
      continue
    }
    const value = inlineValue ?? tokens[index + 1]
    if (value === undefined || (inlineValue === undefined && value.startsWith('-'))) {
      fail(`--${name} 缺少参数`, name)
    }
    if (inlineValue === undefined) index += 1
    options[name] = value
  }

  return { options, positional }
}

function schemaUsageError(
  error: unknown,
  fail: (message: string, field?: string) => never,
  message: string,
): never {
  if (error instanceof z.ZodError) {
    const field = error.issues[0]?.path[0]
    fail(message, typeof field === 'string' ? field : undefined)
  }
  fail(message)
}

function createCommandRequest(
  global: GlobalOptions,
  commandId: string,
  input: unknown,
): ParsedCliRequest {
  const command: ParsedCliCommand = { commandId, input }
  return {
    output: global.output,
    userDataDirectory: global.userDataDirectory,
    profile: global.profile,
    safeMode: global.safeMode,
    request: { kind: 'command', command },
  }
}
