import { join } from 'node:path'

import type { FrontendLock, ProfileLockConflict, UserData } from '../application/index.js'
import type {
  InteractiveRuntimeOptions,
  InteractiveRuntimeRunner,
} from '../runtime/plugin-interface.js'
import type { RuntimeEvent, RuntimeSessionReplacementRequest } from '../shared/runtime-protocol.js'
import type { TuiTerminal } from './contract.js'
import {
  TuiHost,
  type TuiApplicationHost,
  type TuiApplicationServices,
  type TuiHostResult,
  type TuiSignalSource,
} from './host.js'
import {
  formatTuiHelp,
  parseTuiArgs,
  TUI_HELP,
  type ParsedTuiRequest,
  type TuiUsageError,
} from './parser.js'
import type { InProcessRuntimeHost } from './runtime-host.js'
import { createProcessTuiTerminal } from './terminal.js'

export const TUI_EXIT_CODES = Object.freeze({
  success: 0,
  failure: 1,
  usage: 2,
  profileConflict: 4,
  noAvailableTui: 5,
  pluginFailed: 6,
  cancelled: 130,
} as const)

export type TuiExitCode = (typeof TUI_EXIT_CODES)[keyof typeof TUI_EXIT_CODES]

export interface TuiWriter {
  write(content: string): unknown
}

export interface TuiIo {
  readonly stdout: TuiWriter
  readonly stderr: TuiWriter
}

export interface TuiProfileLock extends FrontendLock {
  getConflict?(): ProfileLockConflict | null
}

export interface TuiApplicationHostOptions {
  readonly userData: UserData
  readonly frontendLock: FrontendLock
  readonly safeMode: boolean
  readonly pluginProfile?: 'default' | 'developer'
}

export interface TuiApplicationFactoryContext {
  readonly emit: (event: RuntimeEvent) => void
  readonly requestSessionReplacement: (
    request: RuntimeSessionReplacementRequest,
  ) => Promise<{ accepted: boolean; targetSessionId?: string; message?: string }>
}

export interface TuiApplicationFactoryResult {
  readonly applicationHost: TuiApplicationHost
  readonly runtimeHost: InProcessRuntimeHost
}

export interface TuiDependencies {
  readonly io: TuiIo
  readonly version: string
  readonly resolveUserDataDirectory: (explicitDirectory: string | null) => string
  readonly createProfileLock: (profilePath: string) => TuiProfileLock
  readonly createApplication: (
    options: TuiApplicationHostOptions,
    context: TuiApplicationFactoryContext,
  ) => TuiApplicationFactoryResult | Promise<TuiApplicationFactoryResult>
  readonly createTerminal?: () => TuiTerminal
  readonly signals?: TuiSignalSource
}

export interface TuiRunResult {
  readonly exitCode: TuiExitCode
  readonly error?: { readonly code: string; readonly message: string }
  readonly host?: TuiHostResult
}

export async function runTui(
  arguments_: readonly string[],
  dependencies: TuiDependencies,
): Promise<TuiRunResult> {
  let request: ParsedTuiRequest
  try {
    request = parseTuiArgs(arguments_)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dependencies.io.stderr.write(`${message}\n${formatTuiHelp()}`)
    return { exitCode: TUI_EXIT_CODES.usage, error: { code: 'usage', message } }
  }

  if (request.help) {
    dependencies.io.stdout.write(`${formatTuiHelp()}`)
    return { exitCode: TUI_EXIT_CODES.success }
  }
  if (request.version) {
    dependencies.io.stdout.write(`${dependencies.version}\n`)
    return { exitCode: TUI_EXIT_CODES.success }
  }

  let userDataDirectory: string
  let lock: TuiProfileLock
  try {
    userDataDirectory = dependencies.resolveUserDataDirectory(request.userDataDirectory)
    lock = dependencies.createProfileLock(userDataDirectory)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dependencies.io.stderr.write(`${message}\n`)
    return { exitCode: TUI_EXIT_CODES.failure, error: { code: 'internal', message } }
  }

  const coordinatorReference: {
    current?: TuiApplicationServices['runtime']
  } = {}
  const application = await Promise.resolve()
    .then(() =>
      dependencies.createApplication(
        {
          userData: {
            userDataDirectory,
            dataDirectory: join(userDataDirectory, 'data-v1'),
          },
          frontendLock: lock,
          safeMode: request.safeMode,
          ...(request.profile ? { pluginProfile: request.profile } : {}),
        },
        {
          emit: (event) => coordinatorReference.current?.handleEvent(event),
          requestSessionReplacement: (replacement) =>
            coordinatorReference.current?.handleSessionReplacementRequest(replacement) ??
            Promise.resolve({ accepted: false, message: 'TUI Application Host 尚未就绪' }),
        },
      ),
    )
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      dependencies.io.stderr.write(`${message}\n`)
      return null
    })

  if (!application) {
    return {
      exitCode: TUI_EXIT_CODES.failure,
      error: { code: 'internal', message: '无法创建 TUI Host' },
    }
  }

  const terminal = dependencies.createTerminal?.() ?? createProcessTuiTerminal()
  const host = new TuiHost({
    applicationHost: application.applicationHost,
    terminal,
    interactive: application.runtimeHost,
    launchTarget: {
      projectPath: request.projectPath,
      sessionId: request.sessionId,
      nonInteractive: request.nonInteractive,
      tuiMode: request.tuiMode,
    },
    safeMode: request.safeMode,
    onApplicationStarted: (services) => {
      coordinatorReference.current = services.runtime
    },
    ...(dependencies.signals ? { signals: dependencies.signals } : {}),
  })
  const hostResult = await host.run()
  const result = mapHostResult(hostResult, lock)
  if (result.error) dependencies.io.stderr.write(`${result.error.message}\n`)
  return { ...result, host: hostResult }
}

function mapHostResult(host: TuiHostResult, lock: TuiProfileLock): TuiRunResult {
  if (host.outcome === 'completed') return { exitCode: TUI_EXIT_CODES.success }
  if (host.error?.code === 'cancelled') {
    return { exitCode: TUI_EXIT_CODES.cancelled, error: host.error }
  }
  const conflict = lock.getConflict?.()
  if (conflict) {
    const message = profileConflictMessage(conflict)
    return {
      exitCode: TUI_EXIT_CODES.profileConflict,
      error: { code: 'profile-locked', message },
    }
  }
  if (host.error?.code === 'no-available-tui') {
    return { exitCode: TUI_EXIT_CODES.noAvailableTui, error: host.error }
  }
  if (host.error?.code === 'plugin-failed' || host.error?.code === 'multiple-tui') {
    return { exitCode: TUI_EXIT_CODES.pluginFailed, error: host.error }
  }
  return {
    exitCode: TUI_EXIT_CODES.failure,
    error: host.error ?? { code: 'fatal', message: 'TUI Host 启动失败' },
  }
}

function profileConflictMessage(conflict: ProfileLockConflict): string {
  const owner = conflict.owner
  const ownerText = owner
    ? `Frontend=${owner.frontend}, pid=${owner.pid}, host=${owner.hostname}, acquiredAt=${owner.acquiredAt}`
    : '锁的 owner 元数据不可用；请先人工确认后再处理该锁'
  return `Profile 已被占用（${ownerText}）；lock=${conflict.lockPath}`
}

export type { InteractiveRuntimeOptions, InteractiveRuntimeRunner, TuiUsageError }
export { TUI_HELP }
