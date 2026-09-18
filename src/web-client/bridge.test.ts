import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlatformFilePicker } from '../shared/desktop-bridge.js'

const mocks = vi.hoisted(() => {
  const transports = {
    commands: {},
    modules: {},
    dispose: vi.fn(),
  }
  return {
    connectionStart: vi.fn(async () => undefined),
    connectionStop: vi.fn(),
    releaseState: vi.fn(),
    statusStop: vi.fn(),
    transports,
    createWebTransports: vi.fn(() => transports),
    webFilePickerConstructor: vi.fn(),
  }
})

vi.mock('./connection.js', () => ({
  WebEventConnection: class {
    start = mocks.connectionStart
    stop = mocks.connectionStop
    onState = vi.fn(() => mocks.releaseState)
  },
}))
vi.mock('./connection-status.js', () => ({
  WebConnectionStatusView: class {
    update = vi.fn()
    showReload = vi.fn()
    stop = mocks.statusStop
  },
}))
vi.mock('./file-picker.js', () => ({
  WebFilePicker: class {
    constructor() {
      mocks.webFilePickerConstructor()
    }
  },
}))
vi.mock('./transport.js', () => ({ createWebTransports: mocks.createWebTransports }))

import { createWebFrontendAdapters } from './bridge.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createWebFrontendAdapters', () => {
  it('uses a desktop platform file picker without replacing HTTP/WS business transport', async () => {
    const platformFilePicker: PlatformFilePicker = {
      pickPlugin: vi.fn(async (source) => ({
        ok: true as const,
        value: { source, path: '/plugin' },
      })),
      pickProjectDirectory: vi.fn(async () => ({ ok: true as const, value: '/workspace' })),
      pickSessionImport: vi.fn(async () => ({ ok: true as const, value: '/session.jsonl' })),
      pickSessionExport: vi.fn(async () => ({ ok: true as const, value: '/session.html' })),
      pickMessageImages: vi.fn(async () => ({ ok: true as const, value: null })),
    }

    const adapters = await createWebFrontendAdapters({ platformFilePicker })

    await expect(adapters.bridge.pickProjectDirectory()).resolves.toEqual({
      ok: true,
      value: '/workspace',
    })
    expect(platformFilePicker.pickProjectDirectory).toHaveBeenCalledOnce()
    expect(mocks.webFilePickerConstructor).not.toHaveBeenCalled()
    expect(mocks.createWebTransports).toHaveBeenCalledOnce()

    adapters.stop()
    expect(mocks.transports.dispose).toHaveBeenCalledOnce()
    expect(mocks.connectionStop).toHaveBeenCalledOnce()
  })
})
