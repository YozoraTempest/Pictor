// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  commandEventSchema,
  commandExecutionSchema,
  type CommandClient,
  type CommandEvent,
} from '../commands/contract.js'
import { pluginManagerSnapshotSchema } from '../shared/plugins.js'

import type {
  CliApplicationHost,
  CliDependencies,
  CliIo,
  CliProfileLock,
  CliSignals,
  FrontendLockLease,
} from './contract.js'
import { CLI_EXIT_CODES } from './exit-codes.js'
import { runCli } from './run.js'

const executionId = '11111111-1111-4111-8111-111111111111'

const snapshot = pluginManagerSnapshotSchema.parse({
  safeMode: false,
  restartRequired: false,
  items: [
    {
      kind: 'pictor-plugin',
      id: 'pictor.example',
      name: 'Example',
      version: '1.0.0',
      source: 'local:/tmp/example',
      desiredState: 'enabled',
      effectiveState: 'pending-restart',
      reason: 'Restart Pictor to apply this change',
      canRestore: false,
    },
  ],
  issues: [],
})

class TestSignals implements CliSignals {
  private readonly listeners = new Set<() => void>()

  on(_signal: 'SIGINT', listener: () => void): void {
    this.listeners.add(listener)
  }

  off(_signal: 'SIGINT', listener: () => void): void {
    this.listeners.delete(listener)
  }

  emitSigint(): void {
    for (const listener of this.listeners) listener()
  }
}

function started(commandId: string): CommandEvent {
  return commandEventSchema.parse({
    type: 'started',
    executionId,
    commandId,
    sequence: 0,
    at: '2026-09-01T12:00:00.000Z',
    context: { frontend: 'cli' },
  })
}

function completed(commandId: string, value: unknown): CommandEvent {
  return commandEventSchema.parse({
    type: 'completed',
    executionId,
    commandId,
    sequence: 1,
    at: '2026-09-01T12:00:00.000Z',
    result: { executionId, commandId, value },
  })
}

function cancelled(commandId: string): CommandEvent {
  return commandEventSchema.parse({
    type: 'cancelled',
    executionId,
    commandId,
    sequence: 1,
    at: '2026-09-01T12:00:00.000Z',
    reason: 'requested',
  })
}

function execution(commandId: string) {
  return commandExecutionSchema.parse({ executionId, commandId })
}

function writer(): { output: string; write(content: string): void } {
  const target = { output: '', write(_content: string): void {} }
  target.write = (content: string) => {
    target.output += content
  }
  return target
}

function createDependencies(
  client: CommandClient,
  options: {
    lock?: CliProfileLock
    signals?: CliSignals
    host?: CliApplicationHost
    createApplicationHost?: CliDependencies['createApplicationHost']
    cancelTimeoutMs?: number
  } = {},
): {
  dependencies: CliDependencies
  stdout: ReturnType<typeof writer>
  stderr: ReturnType<typeof writer>
  lock: CliProfileLock
  host: CliApplicationHost
} {
  const stdout = writer()
  const stderr = writer()
  const lock =
    options.lock ??
    ({
      acquire: vi.fn(async () => ({ release: vi.fn() })),
    } satisfies CliProfileLock)
  const host =
    options.host ??
    ({
      start: vi.fn(async () => ({ commandClient: client })),
      stop: vi.fn(async () => undefined),
    } satisfies CliApplicationHost)
  return {
    stdout,
    stderr,
    lock,
    host,
    dependencies: {
      io: { stdout, stderr } satisfies CliIo,
      version: '0.3.0',
      resolveUserDataDirectory: vi.fn(() => '/tmp/pictor-cli-test'),
      createProfileLock: vi.fn(() => lock),
      createApplicationHost: options.createApplicationHost ?? vi.fn(async () => host),
      ...(options.signals ? { signals: options.signals } : {}),
      ...(options.cancelTimeoutMs ? { cancelTimeoutMs: options.cancelTimeoutMs } : {}),
    },
  }
}

function completedClient(
  commandId: string,
  value: unknown,
): {
  client: CommandClient
  execute: ReturnType<typeof vi.fn>
} {
  const execute = vi.fn(async () => execution(commandId))
  const client: CommandClient = {
    list: vi.fn(async () => []),
    execute,
    cancel: vi.fn(async () => ({ executionId, accepted: false })),
    subscribe: vi.fn((_id, listener) => {
      listener(started(commandId))
      listener(completed(commandId, value))
      return vi.fn()
    }),
  }
  return { client, execute }
}

describe('runCli', () => {
  it('answers help and version without creating a lock or ApplicationHost', async () => {
    const { client } = completedClient('plugin.list', snapshot)
    const first = createDependencies(client)
    const second = createDependencies(client)

    await expect(runCli(['--help'], first.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.success,
    })
    await expect(runCli(['--json', 'version'], second.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.success,
    })
    expect(first.dependencies.createProfileLock).not.toHaveBeenCalled()
    expect(first.dependencies.createApplicationHost).not.toHaveBeenCalled()
    expect(second.stdout.output).toBe(
      '{"ok":true,"command":"version","value":{"version":"0.3.0"}}\n',
    )
  })

  it('routes plugin list through CommandClient and formats text output', async () => {
    const { client, execute } = completedClient('plugin.list', snapshot)
    const test = createDependencies(client)

    await expect(runCli(['plugin', 'list'], test.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.success,
    })
    expect(execute).toHaveBeenCalledWith('plugin.list', null, { frontend: 'cli' })
    expect(test.stdout.output).toContain('pictor.example')
    expect(test.stderr.output).toBe('')
    expect(test.host.stop).toHaveBeenCalledOnce()
  })

  it('routes ui aliases and emits exactly one JSON document', async () => {
    const { client, execute } = completedClient('plugin.enable', snapshot)
    const test = createDependencies(client)

    await expect(
      runCli(
        ['--json', 'ui', 'enable', '--kind', 'pictor-plugin', '--id', 'pictor.example'],
        test.dependencies,
      ),
    ).resolves.toMatchObject({ exitCode: CLI_EXIT_CODES.success })
    expect(execute).toHaveBeenCalledWith(
      'plugin.enable',
      { kind: 'pictor-plugin', id: 'pictor.example' },
      { frontend: 'cli' },
    )
    expect(JSON.parse(test.stdout.output)).toMatchObject({
      ok: true,
      command: 'plugin.enable',
      value: snapshot,
    })
    expect(test.stderr.output).toBe('')
  })

  it.each([
    {
      args: ['plugin', 'install', '--source', 'local', '--path', '/tmp/plugin'],
      commandId: 'plugin.install',
      input: { source: 'local', path: '/tmp/plugin' },
    },
    {
      args: ['plugin', 'disable', '--kind', 'pictor-plugin', '--id', 'pictor.example'],
      commandId: 'plugin.disable',
      input: { kind: 'pictor-plugin', id: 'pictor.example' },
    },
  ])('routes $commandId through the CommandClient', async ({ args, commandId, input }) => {
    const { client, execute } = completedClient(commandId, snapshot)
    const test = createDependencies(client)

    await expect(runCli(args, test.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.success,
    })
    expect(execute).toHaveBeenCalledWith(commandId, input, { frontend: 'cli' })
  })

  it('classifies usage errors before lock acquisition and command failures as exit 1', async () => {
    const { client } = completedClient('plugin.list', snapshot)
    const usage = createDependencies(client)
    await expect(
      runCli(['plugin', 'enable', '--id', 'pictor.example'], usage.dependencies),
    ).resolves.toMatchObject({ exitCode: CLI_EXIT_CODES.usage })
    expect(usage.dependencies.createProfileLock).not.toHaveBeenCalled()

    const failureClient: CommandClient = {
      ...client,
      execute: vi.fn(async () => execution('plugin.list')),
      subscribe: vi.fn((_id, listener) => {
        listener(started('plugin.list'))
        listener(
          commandEventSchema.parse({
            type: 'failed',
            executionId,
            commandId: 'plugin.list',
            sequence: 1,
            at: '2026-09-01T12:00:00.000Z',
            error: {
              code: 'handler-failed',
              message: '命令处理器执行失败',
              commandId: 'plugin.list',
              executionId,
            },
          }),
        )
        return vi.fn()
      }),
    }
    const failed = createDependencies(failureClient)
    await expect(runCli(['plugin', 'list'], failed.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.failure,
    })
    expect(failed.stderr.output).toContain('命令处理器执行失败')
  })

  it('returns profile conflict without starting ApplicationHost', async () => {
    const { client } = completedClient('plugin.list', snapshot)
    const lock = {
      acquire: vi.fn(async () => null),
      getConflict: vi.fn(() => ({
        lockPath: '/tmp/pictor-cli-test/.pictor-profile.lock',
        owner: null,
      })),
    } satisfies CliProfileLock
    const test = createDependencies(client, { lock })

    await expect(runCli(['--json', 'doctor'], test.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.profileConflict,
    })
    expect(test.dependencies.createApplicationHost).not.toHaveBeenCalled()
    expect(JSON.parse(test.stdout.output)).toMatchObject({
      ok: false,
      error: { code: 'profile-locked', lockPath: lock.getConflict()?.lockPath },
    })
  })

  it('cancels an active execution on SIGINT and waits for the cancelled terminal event', async () => {
    const signals = new TestSignals()
    const execute = vi.fn(async () => execution('plugin.list'))
    let listener: ((event: CommandEvent) => void) | null = null
    const cancel = vi.fn(async () => {
      listener?.(cancelled('plugin.list'))
      return { executionId, accepted: true }
    })
    const client: CommandClient = {
      list: vi.fn(async () => []),
      execute,
      cancel,
      subscribe: vi.fn((_id, next) => {
        listener = next
        next(started('plugin.list'))
        queueMicrotask(() => signals.emitSigint())
        return vi.fn()
      }),
    }
    const test = createDependencies(client, { signals, cancelTimeoutMs: 100 })

    await expect(runCli(['--json', 'plugin', 'list'], test.dependencies)).resolves.toMatchObject({
      exitCode: CLI_EXIT_CODES.cancelled,
    })
    expect(cancel).toHaveBeenCalledWith(executionId)
    expect(JSON.parse(test.stdout.output)).toMatchObject({
      ok: false,
      error: { code: 'cancelled', executionId },
    })
  })

  it('cancels when SIGINT arrives while execute is still pending', async () => {
    const signals = new TestSignals()
    let resolveExecute!: (value: ReturnType<typeof execution>) => void
    const execute = vi.fn(
      () =>
        new Promise<ReturnType<typeof execution>>((resolve) => {
          resolveExecute = resolve
        }),
    )
    let eventListener: ((event: CommandEvent) => void) | null = null
    const cancel = vi.fn(async () => {
      eventListener?.(cancelled('plugin.list'))
      return { executionId, accepted: true }
    })
    const client: CommandClient = {
      list: vi.fn(async () => []),
      execute,
      cancel,
      subscribe: vi.fn((_id, listener) => {
        eventListener = listener
        listener(started('plugin.list'))
        return vi.fn()
      }),
    }
    const leaseRelease = vi.fn(async () => undefined)
    const lock = {
      acquire: vi.fn(async () => ({ release: leaseRelease })),
    } satisfies CliProfileLock
    let hostLease: FrontendLockLease | null = null
    const host: CliApplicationHost = {
      start: vi.fn(async () => ({ commandClient: client })),
      stop: vi.fn(async () => {
        await hostLease?.release()
      }),
    }
    const createApplicationHost = vi.fn(async (options) => {
      hostLease = await options.frontendLock.acquire()
      return host
    })
    const test = createDependencies(client, {
      lock,
      signals,
      host,
      createApplicationHost,
      cancelTimeoutMs: 100,
    })

    const runPromise = runCli(['plugin', 'list'], test.dependencies)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    signals.emitSigint()
    expect(cancel).not.toHaveBeenCalled()

    resolveExecute(execution('plugin.list'))
    await expect(runPromise).resolves.toMatchObject({ exitCode: CLI_EXIT_CODES.cancelled })
    expect(cancel).toHaveBeenCalledWith(executionId)
    expect(host.stop).toHaveBeenCalledOnce()
    expect(leaseRelease).toHaveBeenCalledOnce()
  })
})
