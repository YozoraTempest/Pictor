import { describe, expect, it } from 'vitest'

import type { HarnessStatus } from '../../shared/bridge.js'
import type { KernelDriver } from './driver.js'
import { KernelRouter } from './router.js'

function status(id: string): HarnessStatus {
  return {
    state: 'ready',
    binary: id === 'dsh' ? '/bin/dsh' : null,
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

/** A driver that records which sessions it was asked about. */
function driver(id: string, options: { models?: boolean } = {}): KernelDriver & { seen: string[] } {
  const seen: string[] = []
  const unsupported = () => Promise.reject(new Error(`${id} 不支持`))

  return {
    id,
    label: id,
    seen,
    capabilities: { permission: true, approval: true, model: true, skills: true, fork: true },
    // A driver that answers for its own models; the picker follows this.
    ...(options.models === true
      ? {
          models: () => Promise.resolve({ models: [], activeId: null }),
          selectModel: () => Promise.resolve(),
        }
      : {}),
    start: () => Promise.resolve(status(id)),
    stop: () => Promise.resolve(status(id)),
    status: () => status(id),
    install: () => Promise.resolve(status(id)),
    prompt: (sessionId) => {
      seen.push(sessionId)
      return Promise.resolve()
    },
    cancel: () => Promise.resolve(),
    fork: () => Promise.resolve('branch'),
    adopt: () => undefined,
    openHistory: () => Promise.resolve({ messages: [], nextOffset: 0, hasMore: false }),
    historyPage: () => Promise.resolve({ messages: [], nextOffset: 0, hasMore: false }),
    onNotification: () => () => undefined,
    answerApproval: unsupported,
    answerQuestions: unsupported,
    setPermissionMode: () => undefined,
    applyPermission: () => Promise.resolve(),
    applySettings: () => Promise.resolve(),
    sessionPermission: () => Promise.resolve(null),
    setSessionPermission: () => Promise.resolve(),
    projectRootFor: () => Promise.resolve(null),
    listSkills: () => Promise.resolve([]),
    probe: () => Promise.resolve({ ok: true, text: '', events: [] }),
  }
}

function router(owners: Record<string, string>, drivers: KernelDriver[]): KernelRouter {
  return new KernelRouter({
    drivers: new Map(drivers.map((entry) => [entry.id, entry])),
    lookup: { kernelOf: (sessionId) => Promise.resolve(owners[sessionId] ?? null) },
  })
}

describe('KernelRouter', () => {
  it('sends a conversation to the kernel it was filed under', async () => {
    const dsh = driver('dsh')
    const other = driver('other')
    const kernels = router({ s1: 'dsh', s2: 'other' }, [dsh, other])

    await kernels.prompt('s1', 'hi')
    await kernels.prompt('s2', 'hi')

    expect(dsh.seen).toEqual(['s1'])
    expect(other.seen).toEqual(['s2'])
  })

  it('falls back to the default for a conversation nobody filed', async () => {
    const dsh = driver('dsh')
    const other = driver('other')
    const kernels = router({}, [dsh, other])

    await kernels.prompt('unknown', 'hi')

    expect(dsh.seen).toEqual(['unknown'])
    expect(other.seen).toEqual([])
  })

  it('refuses a conversation whose kernel this build does not have', async () => {
    // Handing it to another kernel would run the history somewhere it never
    // happened, which is worse than an error.
    const kernels = router({ s1: 'gone' }, [driver('dsh')])

    await expect(kernels.prompt('s1', 'hi')).rejects.toThrow(/gone/)
  })

  it('keeps process-level calls on the default kernel', async () => {
    const dsh = driver('dsh')
    const other = driver('other')
    const kernels = router({}, [dsh, other])

    expect(kernels.status().binary).toBe('/bin/dsh')

    await kernels.start('/tmp')
    expect(kernels.id).toBe('dsh')
  })

  it('reports each kernel’s own status, not the default one’s', () => {
    // The settings page describes every kernel, and they are shaped differently: one
    // server this app boots, one CLI spawned per conversation. A page fed only the
    // default's status would describe the second as stopped forever.
    const kernels = router({}, [driver('dsh'), driver('other')])

    const statuses = kernels.statuses()
    // 'other' is not installed in this fixture, and the point is that its own answer
    // comes back rather than dsh's: the default's path must not be reported for it.
    expect(Object.keys(statuses)).toEqual(['dsh', 'other'])
    expect(statuses['dsh']?.binary).toBe('/bin/dsh')
    expect(statuses['other']?.binary).toBeNull()
  })

  it('describes every kernel for the picker, marking the default and what is installed', () => {
    const kernels = new KernelRouter({
      drivers: new Map([
        ['dsh', driver('dsh')],
        ['other', driver('other')],
      ]),
      lookup: { kernelOf: () => Promise.resolve(null) },
    })

    const everything = { permission: true, approval: true, model: true, skills: true, fork: true }

    expect(kernels.list()).toEqual([
      {
        id: 'dsh',
        label: 'dsh',
        default: true,
        available: true,
        // What a kernel declares travels with it, so the window can hide a
        // control the conversation's kernel cannot answer.
        capabilities: everything,
        modelSource: 'pictor',
      },
      // Not installed: `binary` is null, so the picker can say so instead of
      // offering a kernel that cannot start.
      {
        id: 'other',
        label: 'other',
        default: false,
        available: false,
        capabilities: everything,
        modelSource: 'pictor',
      },
    ])
  })

  it('says whose model list the picker should show', () => {
    const kernels = router({}, [driver('dsh'), driver('other', { models: true })])
    const listed = kernels.list()

    // dsh runs Pictor's models; a kernel that keeps its own catalogue answers for it.
    expect(listed.map((entry) => [entry.id, entry.modelSource])).toEqual([
      ['dsh', 'pictor'],
      ['other', 'kernel'],
    ])
  })

  it('refuses a model request aimed at a kernel without its own models', async () => {
    const kernels = router({ s1: 'dsh' }, [driver('dsh')])

    await expect(kernels.kernelModels('s1')).rejects.toThrow(/不提供自己的模型列表/)
    await expect(kernels.selectKernelModel('s1', 'x')).rejects.toThrow(/不提供自己的模型列表/)
  })

  it('refuses an approval mode aimed at a kernel that decides for itself', async () => {
    const kernels = router({ s1: 'dsh' }, [driver('dsh')])

    await expect(kernels.kernelApproval('s1')).rejects.toThrow(/自己决定何时问人/)
    await expect(kernels.selectKernelApproval('s1', 'mutating')).rejects.toThrow(/自己决定何时问人/)
  })

  it('settles an approval on whichever kernel is holding it', async () => {
    const dsh = driver('dsh')
    const other = { ...driver('other'), answerApproval: () => Promise.resolve() }
    const kernels = router({}, [dsh, other])

    await expect(kernels.answerApproval('e1', true)).resolves.toBeUndefined()
  })

  it('reports every refusal when no kernel can settle an approval', async () => {
    const kernels = router({}, [driver('dsh'), driver('other')])

    await expect(kernels.answerApproval('e1', true)).rejects.toThrow(/dsh.*other/s)
  })
})
