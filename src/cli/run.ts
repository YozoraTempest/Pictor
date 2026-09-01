import { join } from 'node:path'

import type { z } from 'zod'

import { appDoctorResultSchema } from '../commands/core.js'
import { pluginManagerSnapshotSchema } from '../shared/plugins.js'
import { CommandFailure, type CommandClient, type CommandEvent } from '../commands/index.js'

import { CLI_EXIT_CODES, type CliExitCode } from './exit-codes.js'
import { CLI_HELP, formatHelp } from './help.js'
import { writeFailure, writeSuccess } from './format.js'
import { CliUsageError, parseCliArgs } from './parser.js'

import type {
  CliApplicationHost,
  CliDependencies,
  CliError,
  CliProfileLock,
  CliRunResult,
  FrontendLock,
  FrontendLockLease,
  ParsedCliRequest,
} from './contract.js'

const DEFAULT_CANCEL_TIMEOUT_MS = 5_000

class CliCancelledError extends Error {
  readonly name = 'CliCancelledError'

  constructor(
    message: string,
    readonly executionId?: string,
  ) {
    super(message)
  }
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<CliRunResult> {
  let request: ParsedCliRequest
  try {
    request = parseCliArgs(arguments_)
  } catch (error) {
    const output = error instanceof CliUsageError ? error.output : 'text'
    const cliError = toCliError(error, '命令行参数解析失败')
    writeFailure(dependencies.io, output, cliError)
    return { exitCode: CLI_EXIT_CODES.usage, error: cliError }
  }

  if (request.request.kind === 'help') {
    const value = { ...requestHelpValue(request.request.topic) }
    writeSuccess(dependencies.io, request.output, 'help', value)
    return { exitCode: CLI_EXIT_CODES.success }
  }

  if (request.request.kind === 'version') {
    writeSuccess(dependencies.io, request.output, 'version', { version: dependencies.version })
    return { exitCode: CLI_EXIT_CODES.success }
  }

  const command = request.request.command
  let userDataDirectory: string
  let lock: CliProfileLock
  try {
    userDataDirectory = dependencies.resolveUserDataDirectory(request.userDataDirectory)
    lock = dependencies.createProfileLock(userDataDirectory)
  } catch (error) {
    const cliError = toCliError(error, '无法解析 Profile 目录')
    writeFailure(dependencies.io, request.output, cliError)
    return { exitCode: CLI_EXIT_CODES.failure, error: cliError }
  }

  let lease!: FrontendLockLease | null
  try {
    lease = await lock.acquire()
  } catch (error) {
    const cliError = toCliError(error, '无法获取 Profile 锁')
    writeFailure(dependencies.io, request.output, cliError)
    return { exitCode: CLI_EXIT_CODES.failure, error: cliError }
  }

  if (!lease) {
    const cliError = profileConflictError(lock)
    writeFailure(dependencies.io, request.output, cliError)
    return { exitCode: CLI_EXIT_CODES.profileConflict, error: cliError }
  }

  const preAcquiredLock = createPreAcquiredLock(lease)
  const userData = {
    userDataDirectory,
    dataDirectory: join(userDataDirectory, 'data-v1'),
  }
  let host: CliApplicationHost | null = null
  let value: unknown
  let operationError: unknown = null
  let interruptedBeforeExecution = false
  const onEarlyInterrupt = (): void => {
    interruptedBeforeExecution = true
  }

  try {
    dependencies.signals?.on('SIGINT', onEarlyInterrupt)
    try {
      host = await dependencies.createApplicationHost({
        userData,
        frontendLock: preAcquiredLock.lock,
        safeMode: request.safeMode,
        ...(request.profile ? { pluginProfile: request.profile } : {}),
      })
      const services = await host.start()
      if (interruptedBeforeExecution) {
        throw new CliCancelledError('CLI 在命令执行开始前已取消')
      }
      value = await executeCliCommand(
        services.commandClient,
        command.commandId,
        command.input,
        commandOutputSchema(command.commandId),
        dependencies.signals,
        dependencies.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS,
      )
    } catch (error) {
      operationError = error
    }

    if (host) {
      try {
        await host.stop()
      } catch (error) {
        operationError ??= error
      }
    }

    try {
      await preAcquiredLock.releaseIfUnclaimed()
    } catch (error) {
      operationError ??= error
    }
  } catch (error) {
    operationError ??= error
  } finally {
    dependencies.signals?.off('SIGINT', onEarlyInterrupt)
  }

  if (operationError !== null) {
    const cliError = toCliError(operationError, 'CLI 命令执行失败', command.commandId)
    writeFailure(dependencies.io, request.output, cliError)
    return { exitCode: exitCodeForError(cliError), error: cliError }
  }

  writeSuccess(dependencies.io, request.output, command.commandId, value)
  return { exitCode: CLI_EXIT_CODES.success }
}

function requestHelpValue(topic: readonly string[]): {
  readonly usage: string
  readonly options: readonly string[]
  readonly commands: readonly string[]
  readonly notes: readonly string[]
  readonly topic: readonly string[]
  readonly text: string
} {
  const document = { ...CLI_HELP, topic: [...topic] }
  return { ...document, text: formatHelp(document) }
}

function commandOutputSchema(commandId: string): z.ZodType<unknown> {
  if (commandId === 'app.doctor') return appDoctorResultSchema
  return pluginManagerSnapshotSchema
}

async function executeCliCommand<T>(
  client: CommandClient,
  commandId: string,
  input: unknown,
  outputSchema: z.ZodType<T>,
  signals: CliDependencies['signals'],
  cancelTimeoutMs: number,
): Promise<T> {
  let resolveTerminal!: (event: CommandEvent) => void
  const terminalPromise = new Promise<CommandEvent>((resolve) => {
    resolveTerminal = resolve
  })
  let resolveInterrupt!: () => void
  const interruptPromise = new Promise<void>((resolve) => {
    resolveInterrupt = resolve
  })
  let interrupted = false
  let cancelError: unknown = null
  let cancelPromise: Promise<unknown> | null = null
  let terminal: CommandEvent | null = null
  let releaseSubscription: (() => void) | null = null
  let executionId: string | null = null

  const requestCancel = (id: string): void => {
    if (cancelPromise !== null) return
    cancelPromise = Promise.resolve()
      .then(() => client.cancel(id))
      .catch((error: unknown) => {
        cancelError = error
        return null
      })
  }

  const onInterrupt = (): void => {
    if (interrupted || terminal !== null) return
    interrupted = true
    resolveInterrupt()
    if (executionId !== null) requestCancel(executionId)
  }

  const onEvent = (event: CommandEvent): void => {
    if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
      if (terminal === null) {
        terminal = event
        resolveTerminal(event)
      }
    }
  }

  try {
    signals?.on('SIGINT', onInterrupt)
    const execution = await client.execute(commandId, input, { frontend: 'cli' })
    executionId = execution.executionId
    if (interrupted) requestCancel(execution.executionId)
    releaseSubscription = client.subscribe(execution.executionId, onEvent)
    if (interrupted) {
      await waitForCancel(cancelPromise, cancelTimeoutMs)
      terminal = await waitForTerminal(terminalPromise, cancelTimeoutMs)
      if (terminal === null) {
        const detail = cancelError instanceof Error ? `：${cancelError.message}` : ''
        throw new CliCancelledError(`取消命令超时${detail}`, execution.executionId)
      }
    } else if (terminal === null) {
      const first = await Promise.race([
        terminalPromise.then((event) => ({ kind: 'terminal' as const, event })),
        interruptPromise.then(() => ({ kind: 'interrupt' as const })),
      ])
      if (first.kind === 'terminal') {
        terminal = first.event
      } else {
        await waitForCancel(cancelPromise, cancelTimeoutMs)
        terminal = await waitForTerminal(terminalPromise, cancelTimeoutMs)
        if (terminal === null) {
          const detail = cancelError instanceof Error ? `：${cancelError.message}` : ''
          throw new CliCancelledError(`取消命令超时${detail}`, execution.executionId)
        }
      }
    }

    if (!terminal) terminal = await terminalPromise
    if (interrupted && terminal.type !== 'cancelled') {
      throw new CliCancelledError('命令未进入取消终态', execution.executionId)
    }
    if (terminal.type === 'cancelled') {
      throw new CliCancelledError('命令已取消', terminal.executionId)
    }
    if (terminal.type === 'failed') throw new CommandFailure(terminal.error)
    if (terminal.type !== 'completed') {
      throw new CommandFailure({
        code: 'handler-failed',
        message: '命令未返回终态结果',
        commandId: execution.commandId,
        executionId: execution.executionId,
      })
    }
    try {
      return outputSchema.parse(terminal.result.value)
    } catch {
      throw new CommandFailure({
        code: 'invalid-output',
        message: '命令输出无效',
        commandId: execution.commandId,
        executionId: execution.executionId,
      })
    }
  } finally {
    signals?.off('SIGINT', onInterrupt)
    releaseSubscription?.()
  }
}

async function waitForCancel(
  cancelPromise: Promise<unknown> | null,
  timeoutMs: number,
): Promise<void> {
  if (!cancelPromise) return
  await waitForPromise(cancelPromise, timeoutMs)
}

async function waitForTerminal(
  terminalPromise: Promise<CommandEvent>,
  timeoutMs: number,
): Promise<CommandEvent | null> {
  return waitForPromise(terminalPromise, timeoutMs)
}

async function waitForPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), safeTimeout)
  })
  const result = await Promise.race([promise, timeout])
  if (timer !== undefined) clearTimeout(timer)
  return result
}

function createPreAcquiredLock(lease: FrontendLockLease): {
  readonly lock: FrontendLock
  readonly releaseIfUnclaimed: () => Promise<void>
} {
  let transferred = false
  let released = false
  const lock: FrontendLock = {
    acquire: async () => {
      if (transferred) throw new Error('CLI Profile lock was acquired more than once')
      transferred = true
      return lease
    },
  }
  return {
    lock,
    releaseIfUnclaimed: async () => {
      if (transferred || released) return
      released = true
      await lease.release()
    },
  }
}

function profileConflictError(lock: CliProfileLock): CliError {
  const conflict = lock.getConflict?.()
  const owner = conflict?.owner
    ? {
        schemaVersion: conflict.owner.schemaVersion,
        pid: conflict.owner.pid,
        hostname: conflict.owner.hostname,
        frontend: conflict.owner.frontend,
        profilePath: conflict.owner.profilePath,
        acquiredAt: conflict.owner.acquiredAt,
      }
    : null
  const ownerDescription = owner
    ? `Frontend=${owner.frontend}, pid=${owner.pid}, host=${owner.hostname}, acquiredAt=${owner.acquiredAt}`
    : '锁的 owner 元数据不可用；请先人工确认后再处理该锁'
  return {
    code: 'profile-locked',
    message: `Profile 已被占用（${ownerDescription}）${conflict ? `；lock=${conflict.lockPath}` : ''}`,
    ...(conflict ? { lockPath: conflict.lockPath, owner } : {}),
  }
}

function toCliError(error: unknown, fallback: string, commandId?: string): CliError {
  if (error instanceof CliUsageError) {
    return {
      code: 'usage',
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    }
  }
  if (error instanceof CliCancelledError) {
    return {
      code: 'cancelled',
      message: error.message,
      ...(error.executionId ? { executionId: error.executionId } : {}),
      ...(commandId ? { commandId } : {}),
    }
  }
  if (error instanceof CommandFailure) {
    const errorCode = error.code === 'cancelled' ? 'cancelled' : 'command-failed'
    const resolvedCommandId = error.commandId ?? commandId
    return {
      code: errorCode,
      message: error.message,
      ...(resolvedCommandId ? { commandId: resolvedCommandId } : {}),
      ...(error.executionId ? { executionId: error.executionId } : {}),
      ...(error.field ? { field: error.field } : {}),
    }
  }
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : fallback,
    ...(commandId ? { commandId } : {}),
  }
}

function exitCodeForError(error: CliError): CliExitCode {
  if (error.code === 'cancelled') return CLI_EXIT_CODES.cancelled
  return CLI_EXIT_CODES.failure
}
