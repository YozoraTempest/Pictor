import { describe, expect, it } from 'vitest'

import type { HarnessStatus } from '../../shared/bridge.js'
import type { KernelDriver, KernelSetting } from '@vulonlok/kernel-sdk'
import { DshHarness } from './dsh.js'

function status(): HarnessStatus {
  return {
    state: 'ready',
    binary: '/bin/dsh',
    version: '1.0.0',
    expectedVersion: '1.0.0',
    home: '/home',
    provider: null,
    model: null,
    serverInfo: null,
    permissionMode: 'workspace-write',
    error: null,
  }
}

/**
 * A driver that records what it was asked.
 *
 * The shape is the contract the app has always talked to; what changed is that there is
 * one of these instead of a map of them.
 */
function engine(
  options: {
    models?: boolean
    approval?: boolean
    jobs?: boolean
    settings?: KernelSetting[]
    catalogue?: () => void
  } = {},
): KernelDriver & { seen: string[]; approvals: string[] } {
  const seen: string[] = []
  const approvals: string[] = []

  return {
    id: 'dsh',
    label: 'DeepSeek Harness',
    icon: 'waves',
    seen,
    approvals,
    capabilities: {
      permission: true,
      approval: options.approval ?? false,
      model: true,
      skills: true,
      fork: true,
      commands: false,
      jobs: options.jobs ?? false,
    },
    ...(options.models === true
      ? {
          models: () => Promise.resolve({ models: [], activeId: null }),
          selectModel: () => Promise.resolve(),
          setEffort: () => Promise.resolve(),
        }
      : {}),
    ...(options.approval === true
      ? {
          approvalMode: () => 'always' as const,
          setApprovalMode: () => undefined,
          isGranted: () => true,
          grantTool: () => undefined,
          grantedTools: () => ['bash'],
          revokeGrants: () => undefined,
        }
      : {}),
    ...(options.settings === undefined ? {} : { settings: () => options.settings ?? [] }),
    ...(options.catalogue === undefined ? {} : { invalidateCatalogue: options.catalogue }),
    ...(options.jobs === true
      ? { jobs: () => Promise.resolve([]), killJob: () => Promise.resolve() }
      : {}),
    start: () => Promise.resolve(status()),
    stop: () => Promise.resolve(status()),
    status,
    install: () => Promise.resolve(status()),
    prompt: (sessionId: string) => {
      seen.push(sessionId)
      return Promise.resolve()
    },
    cancel: () => Promise.resolve(),
    fork: () => Promise.resolve('child'),
    adopt: () => undefined,
    openHistory: () => Promise.resolve({ messages: [], nextOffset: 0, hasMore: false }),
    historyPage: () => Promise.resolve({ messages: [], nextOffset: 0, hasMore: false }),
    onNotification: () => () => undefined,
    answerApproval: (eventId: string) => {
      approvals.push(eventId)
      return Promise.resolve()
    },
    answerQuestions: () => Promise.resolve(),
    setPermissionMode: () => undefined,
    applyPermission: () => Promise.resolve(),
    applySettings: () => Promise.resolve(),
    sessionPermission: () => Promise.resolve(null),
    setSessionPermission: () => Promise.resolve(),
    projectRootFor: () => Promise.resolve(null),
    listSkills: () => Promise.resolve([]),
    probe: (prompt: string) => Promise.resolve({ ok: true, text: prompt, events: [] }),
  }
}

describe('DshHarness', () => {
  it('forwards a conversation call to the one engine', async () => {
    const driver = engine()
    const harness = new DshHarness(driver)

    await harness.prompt('s1', '写点什么')
    await harness.prompt('s2', '再写点什么')

    // No lookup, no routing: the session id names the transcript, and both go to dsh.
    expect(driver.seen).toEqual(['s1', 's2'])
  })

  it('describes itself as the single engine', () => {
    const harness = new DshHarness(engine())
    const listed = harness.list()

    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe('dsh')
    expect(listed[0]?.default).toBe(true)
    expect(listed[0]?.available).toBe(true)
    // dsh runs Pictor's models, so the picker shows Pictor's list.
    expect(listed[0]?.modelSource).toBe('pictor')
    expect(Object.keys(harness.statuses())).toEqual(['dsh'])
    expect(harness.id).toBe('dsh')
  })

  it('can only name itself as the default', () => {
    const harness = new DshHarness(engine())

    expect(harness.setDefault('dsh')).toBe(true)
    expect(harness.setDefault('pi')).toBe(false)
  })

  it('answers the capabilities the engine does not have instead of failing', async () => {
    const harness = new DshHarness(engine())

    // No job registry: the roster is empty, so nothing offers a stop button.
    expect(await harness.kernelJobs('s1')).toEqual([])
    // No command source: an empty slash menu is a truthful answer.
    expect(await harness.kernelCommands('s1')).toEqual([])
    // No approval source: the guard is told the runtime decides for itself.
    expect(await harness.guardApprovalMode('s1')).toBe('never')
    expect(await harness.guardIsGranted('s1', 'bash')).toBe(false)
    // A model catalogue it does not have is a wiring question, so it is named.
    await expect(harness.kernelModels('s1')).rejects.toThrow('不提供自己的模型列表')
  })

  it('uses the capabilities the engine does have', async () => {
    const harness = new DshHarness(engine({ models: true, approval: true, jobs: true }))

    expect(await harness.kernelModels('s1')).toEqual({ models: [], activeId: null })
    expect(await harness.kernelApproval('s1')).toBe('always')
    expect(await harness.guardApprovalMode('s1')).toBe('always')
    expect(await harness.kernelGrants('s1')).toEqual(['bash'])
    expect(await harness.kernelJobs('s1')).toEqual([])
  })

  it('reads declared settings from the engine and writes them back', async () => {
    let value = false
    const setting: KernelSetting = {
      key: 'autoTitle',
      label: '自动命名',
      description: '按第一句话给会话取名',
      hint: () => (value ? '开' : '关'),
      read: () => value,
      write: (next: boolean) => {
        value = next
        return Promise.resolve()
      },
    }
    const harness = new DshHarness(engine({ settings: [setting] }))

    expect(harness.settings()).toEqual([
      {
        kernel: 'dsh',
        key: 'autoTitle',
        label: '自动命名',
        description: '按第一句话给会话取名',
        hint: '关',
        value: false,
      },
    ])

    expect(await harness.setKernelSetting('autoTitle', true)).toBe(true)
    expect(value).toBe(true)
    // A key nobody declares is reported rather than silently dropped.
    expect(await harness.setKernelSetting('nope', true)).toBe(false)
  })

  it('settles an answer against the engine that minted the event', async () => {
    const driver = engine()
    const harness = new DshHarness(driver)

    await harness.answerApproval('event-1', true)

    expect(driver.approvals).toEqual(['event-1'])
  })

  it('only invalidates a catalogue that exists', () => {
    let calls = 0
    new DshHarness(engine()).invalidateCatalogues()
    expect(calls).toBe(0)

    new DshHarness(engine({ catalogue: () => (calls += 1) })).invalidateCatalogues()
    expect(calls).toBe(1)
  })
})
