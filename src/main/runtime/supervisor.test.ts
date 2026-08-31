// @vitest-environment node

import { EventEmitter } from 'node:events'

import type { UtilityProcess } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimePluginBootstrap } from '../../shared/plugins.js'
import type {
  RuntimeCommand,
  RuntimeNavigateConfig,
  RuntimeSessionOpenConfig,
  RuntimeStartConfig,
} from '../../shared/runtime-protocol.js'
import { RuntimeSupervisor } from './supervisor.js'

const forkMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  utilityProcess: { fork: forkMock },
}))

const sessionA = '11111111-1111-4111-8111-111111111111'
const sessionB = '22222222-2222-4222-8222-222222222222'
const operationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const pluginBootstrap: RuntimePluginBootstrap = {
  safeMode: false,
  pictorVersion: '0.3.0',
  plugins: [],
  extensions: [],
  skills: [],
  prompts: [],
}

const settings = {
  apiProtocol: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1',
  modelId: 'test-model',
  reasoningEffort: null,
  temperature: null,
  maxOutputTokens: null,
}

class FakeUtilityProcess extends EventEmitter {
  readonly postMessage = vi.fn((_command: RuntimeCommand) => undefined)
  readonly kill = vi.fn(() => this.emit('exit', 1))

  send(message: unknown): void {
    this.emit('message', message)
  }

  exit(): void {
    this.emit('exit', 1)
  }
}

let processes: FakeUtilityProcess[]

function createSupervisor(onEvent = vi.fn()): RuntimeSupervisor {
  return new RuntimeSupervisor(onEvent, pluginBootstrap)
}

function sessionOpenConfig(
  sessionId = sessionA,
  operationId = operationA,
): RuntimeSessionOpenConfig {
  return {
    type: 'session.open',
    operationId,
    sessionId,
    projectRoot: '/workspace',
    agentDirectory: '/agent',
    sessionDirectory: `/sessions/${sessionId}`,
    resumeSession: false,
    settings,
    apiKey: 'secret',
  }
}

function startConfig(sessionId = sessionA): RuntimeStartConfig {
  return {
    ...sessionOpenConfig(sessionId, runId),
    type: 'start',
    runId,
    messageId: operationB,
    prompt: 'hello',
  }
}

function navigateConfig(): RuntimeNavigateConfig {
  return {
    type: 'navigate',
    operationId: operationB,
    sourceSessionId: sessionB,
    entryId: 'entry-1',
    summarize: false,
    customInstructions: null,
    activeLeafId: 'entry-1',
    projectRoot: '/workspace',
    agentDirectory: '/agent',
    settings,
    apiKey: 'secret',
  }
}

async function openSession(
  supervisor: RuntimeSupervisor,
  sessionId = sessionA,
  operationId = operationA,
): Promise<FakeUtilityProcess> {
  const config = sessionOpenConfig(sessionId, operationId)
  const opened = supervisor.openSession(config)
  const child = processes.at(-1)
  if (!child) throw new Error('Runtime process was not started')
  child.send({ type: 'host.ready' })
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith(config))
  child.send({
    type: 'host.sessionResult',
    operationId,
    sessionId,
    outcome: 'opened',
  })
  await opened
  return child
}

beforeEach(() => {
  processes = []
  forkMock.mockReset()
  forkMock.mockImplementation(() => {
    const child = new FakeUtilityProcess()
    processes.push(child)
    return child as unknown as UtilityProcess
  })
})

describe('RuntimeSupervisor state machine', () => {
  it('serializes operations that wait on the same process startup', async () => {
    const supervisor = createSupervisor()
    const firstConfig = sessionOpenConfig(sessionA, operationA)
    const secondConfig = sessionOpenConfig(sessionB, operationB)
    const first = supervisor.openSession(firstConfig)
    const second = supervisor.openSession(secondConfig)
    const child = processes[0]
    if (!child) throw new Error('Runtime process was not started')

    child.send({ type: 'host.ready' })

    await expect(second).rejects.toThrow('已有 Runtime 操作正在执行')
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(1))
    expect(child.postMessage).toHaveBeenCalledWith(firstConfig)

    child.send({
      type: 'host.sessionResult',
      operationId: operationA,
      sessionId: sessionA,
      outcome: 'opened',
    })
    await expect(first).resolves.toBeUndefined()
  })

  it('keeps a request pending until its correlation fields match', async () => {
    const supervisor = createSupervisor()
    const child = await openSession(supervisor)
    const controls = supervisor.getRuntimeControls(sessionA)

    child.send({
      type: 'host.controlsResult',
      sessionId: sessionB,
      modelId: 'ignored-model',
      thinkingLevel: 'off',
      activeTools: [],
      availableTools: [],
      steeringMode: 'all',
      followUpMode: 'all',
    })

    await expect(supervisor.getRuntimeControls(sessionA)).rejects.toThrow(
      '已有 Session Controls 查询正在执行',
    )

    const expected = {
      type: 'host.controlsResult' as const,
      sessionId: sessionA,
      modelId: 'test-model',
      thinkingLevel: 'high' as const,
      activeTools: ['read'],
      availableTools: ['read', 'bash'],
      steeringMode: 'all' as const,
      followUpMode: 'one-at-a-time' as const,
    }
    child.send(expected)
    await expect(controls).resolves.toEqual(expected)
  })

  it('rejects every pending request on a fatal host message', async () => {
    const supervisor = createSupervisor()
    const child = await openSession(supervisor)
    const reload = supervisor.reloadResources(sessionA)
    const controls = supervisor.getRuntimeControls(sessionA)

    child.send({ type: 'host.fatal', message: 'runtime failed' })

    await expect(reload).rejects.toThrow('runtime failed')
    await expect(controls).rejects.toThrow('runtime failed')

    const retry = supervisor.getRuntimeControls(sessionA)
    child.send({
      type: 'host.controlsResult',
      sessionId: sessionA,
      modelId: null,
      thinkingLevel: 'off',
      activeTools: [],
      availableTools: [],
      steeringMode: 'all',
      followUpMode: 'all',
    })
    await expect(retry).resolves.toMatchObject({ sessionId: sessionA })
  })

  it('restores the previous session after a failed session operation', async () => {
    const supervisor = createSupervisor()
    const child = await openSession(supervisor)
    const config = navigateConfig()
    const navigation = supervisor.navigateSession(config)
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith(config))

    child.send({
      type: 'host.navigateResult',
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      outcome: 'failed',
      message: 'cannot navigate',
    })
    await expect(navigation).resolves.toMatchObject({ outcome: 'failed' })

    await expect(supervisor.getRuntimeControls(sessionB)).resolves.toBeNull()
    const controls = supervisor.getRuntimeControls(sessionA)
    child.send({
      type: 'host.controlsResult',
      sessionId: sessionA,
      modelId: null,
      thinkingLevel: 'off',
      activeTools: [],
      availableTools: [],
      steeringMode: 'all',
      followUpMode: 'all',
    })
    await expect(controls).resolves.toMatchObject({ sessionId: sessionA })
  })

  it('rejects pending work, clears session state, and starts a fresh process after exit', async () => {
    const supervisor = createSupervisor()
    const firstChild = await openSession(supervisor)
    const reload = supervisor.reloadResources(sessionA)

    firstChild.exit()

    await expect(reload).rejects.toThrow('Agent Runtime 在资源重载完成前退出')
    await expect(supervisor.getRuntimeControls(sessionA)).resolves.toBeNull()

    const reopened = supervisor.openSession(sessionOpenConfig(sessionB, operationB))
    const secondChild = processes[1]
    if (!secondChild) throw new Error('Replacement runtime process was not started')
    secondChild.send({ type: 'host.ready' })
    await vi.waitFor(() => expect(secondChild.postMessage).toHaveBeenCalledTimes(1))

    firstChild.send({
      type: 'host.sessionResult',
      operationId: operationB,
      sessionId: sessionB,
      outcome: 'opened',
    })
    await expect(supervisor.openSession(sessionOpenConfig(sessionA, operationA))).rejects.toThrow(
      '已有 Runtime 操作正在执行',
    )

    secondChild.send({
      type: 'host.sessionResult',
      operationId: operationB,
      sessionId: sessionB,
      outcome: 'opened',
    })
    await expect(reopened).resolves.toBeUndefined()
    expect(forkMock).toHaveBeenCalledTimes(2)
  })

  it('emits a synthetic terminal failure when the process exits during a run', async () => {
    const onEvent = vi.fn()
    const supervisor = createSupervisor(onEvent)
    const started = supervisor.start(startConfig())
    const child = processes[0]
    if (!child) throw new Error('Runtime process was not started')
    child.send({ type: 'host.ready' })
    await started

    child.exit()

    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'runtime.error',
        runId,
        sessionId: sessionA,
        message: 'Agent Runtime 进程意外退出',
      }),
    )
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'run.stateChanged',
        runId,
        sessionId: sessionA,
        status: 'failed',
      }),
    )
    expect(supervisor.isActive()).toBe(false)
  })
})
