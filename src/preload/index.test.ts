// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlatformFilePicker } from '../shared/desktop-bridge.js'

const mocks = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  return {
    exposed,
    invoke: vi.fn(),
    exposeInMainWorld: vi.fn((name: string, value: unknown) => exposed.set(name, value)),
  }
})

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: { invoke: mocks.invoke },
}))

import './index.js'

const picker = mocks.exposed.get('pictorDesktop') as PlatformFilePicker

beforeEach(() => {
  mocks.invoke.mockReset()
})

describe('preload desktop platform adapter', () => {
  it('exposes only the native file picker capability', () => {
    expect(picker).toBeDefined()
    expect(mocks.exposed.has('pictor')).toBe(false)
    expect(mocks.exposed.has('pictorModules')).toBe(false)
  })

  it('validates picker input and output while leaving business transport to Web Host', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        ok: true,
        value: { source: 'development', path: '/workspace/development-plugin' },
      })
      .mockResolvedValueOnce({ ok: true, value: '/workspace/Pictor' })
      .mockResolvedValueOnce({ ok: true, value: '/exports/session.html' })

    await expect(picker.pickPlugin('development')).resolves.toEqual({
      ok: true,
      value: { source: 'development', path: '/workspace/development-plugin' },
    })
    await expect(picker.pickProjectDirectory()).resolves.toEqual({
      ok: true,
      value: '/workspace/Pictor',
    })
    await expect(
      picker.pickSessionExport({ format: 'html', defaultFileName: 'session.html' }),
    ).resolves.toEqual({ ok: true, value: '/exports/session.html' })

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'plugin:pick', {
      source: 'development',
    })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'workspace:pick-project-directory')
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, 'workspace:pick-session-export', {
      format: 'html',
      defaultFileName: 'session.html',
    })
  })
})
