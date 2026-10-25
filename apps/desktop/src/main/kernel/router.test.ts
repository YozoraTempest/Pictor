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
function driver(id: string): KernelDriver & { seen: string[] } {
  const seen: string[] = []
  const unsupported = () => Promise.reject(new Error(`${id} 不支持`))

  return {
    id,
    seen,
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

  it('describes every kernel for the picker, marking the default and what is installed', () => {
    const kernels = new KernelRouter({
      drivers: new Map([
        ['dsh', driver('dsh')],
        ['other', driver('other')],
      ]),
      labels: { dsh: 'DeepSeek Harness' },
      lookup: { kernelOf: () => Promise.resolve(null) },
    })

    expect(kernels.list()).toEqual([
      { id: 'dsh', label: 'DeepSeek Harness', default: true, available: true },
      // Not installed: `binary` is null, so the picker can say so instead of
      // offering a kernel that cannot start.
      { id: 'other', label: 'other', default: false, available: false },
    ])
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
