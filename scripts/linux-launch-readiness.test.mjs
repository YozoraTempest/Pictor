import { describe, expect, it, vi } from 'vitest'

import { collectLaunchEvidence } from './linux-launch-readiness.mjs'

describe('collectLaunchEvidence', () => {
  it('waits for the renderer terminal state after DOMContentLoaded', async () => {
    globalThis.document.body.innerHTML = '<main class="app-loading">正在打开 Pictor</main>'
    const invoke = vi.fn().mockResolvedValue({
      name: 'pictor',
      version: '0.2.1',
      platform: 'linux',
      arch: 'x64',
      distribution: 'unsupported-linux',
    })
    globalThis.pictorModules = {
      invoke,
    }
    const window = {
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockImplementation(async (predicate) => {
        expect(predicate()).toBe(false)
        globalThis.document.body.innerHTML = '<main class="app-shell">Pictor</main>'
        expect(predicate()).toBe(true)
      }),
      evaluate: vi.fn().mockImplementation(async (callback) => callback()),
    }

    const evidence = await collectLaunchEvidence(window)

    expect(window.waitForFunction).toHaveBeenCalledOnce()
    expect(evidence.terminalState).toBe('ready')
    expect(evidence.shell).not.toBeNull()
    expect(evidence.appInfo.version).toBe('0.2.1')
    expect(invoke).toHaveBeenCalledWith('pictor.updater', 'getAppInfo', null)
  })

  it('reports fatal renderer text without retrying the failed app-info IPC', async () => {
    globalThis.document.body.innerHTML = '<main class="app-loading">正在打开 Pictor</main>'
    const invoke = vi.fn().mockRejectedValue(new Error('IPC unavailable'))
    globalThis.pictorModules = { invoke }
    const window = {
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockImplementation(async (predicate) => {
        expect(predicate()).toBe(false)
        globalThis.document.body.innerHTML =
          '<main class="fatal-state"><h1>无法加载本地工作区</h1><p>应用信息读取失败</p></main>'
        expect(predicate()).toBe(true)
      }),
      evaluate: vi.fn().mockImplementation(async (callback) => callback()),
    }

    await expect(collectLaunchEvidence(window)).rejects.toThrow(
      /Packaged renderer entered fatal state: 无法加载本地工作区.*应用信息读取失败/s,
    )

    expect(window.waitForFunction).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })
})
