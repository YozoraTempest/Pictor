// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CommandClient } from '../commands/index.js'
import type { AppInfo } from '../shared/app-info.js'
import type { PluginBootstrap } from '../shared/plugins.js'
import type { Disposable } from '../kernel/module.js'
import type { PluginManager } from './plugins/plugin-manager.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { senderFrame: null }, input?: unknown) => unknown>()
  return {
    handlers,
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    commandExecute: vi.fn(),
  }
})

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialog: mocks.showSaveDialog,
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: { senderFrame: null }, input?: unknown) => unknown,
    ) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
}))

import { registerIpc } from './ipc.js'

const roots: string[] = []
let registration: Disposable
const commandClient: CommandClient = {
  list: vi.fn(async () => []),
  execute: mocks.commandExecute.mockImplementation(async (commandId: string) => ({
    executionId: '00000000-0000-4000-8000-000000000001',
    commandId,
  })),
  cancel: vi.fn(async () => ({
    executionId: '00000000-0000-4000-8000-000000000001',
    accepted: false,
  })),
  subscribe: vi.fn(() => () => undefined),
}

async function invoke(channel: string, input?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ senderFrame: null }, input)
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.showOpenDialog.mockReset()
  mocks.showSaveDialog.mockReset()
  mocks.commandExecute.mockClear()
  registration = registerIpc({
    validateSender: vi.fn(),
    onRendererReady: vi.fn(async () => undefined),
    appInfo: {} as AppInfo,
    getPluginBootstrap: vi.fn(async () => ({}) as PluginBootstrap),
    pluginManager: {
      getSnapshot: vi.fn(async () => ({
        safeMode: false,
        restartRequired: false,
        items: [],
        issues: [],
      })),
    } as unknown as PluginManager,
    commandClient,
  })
})

afterEach(async () => {
  registration.dispose()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Desktop Agent Workspace picker adapter', () => {
  it('returns explicit paths and preserves cancellation for directory and import pickers', async () => {
    mocks.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/workspace/Pictor'] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })

    await expect(invoke('workspace:pick-project-directory')).resolves.toEqual({
      ok: true,
      value: '/workspace/Pictor',
    })
    await expect(invoke('workspace:pick-session-import')).resolves.toEqual({
      ok: true,
      value: null,
    })
    expect(mocks.showOpenDialog).toHaveBeenNthCalledWith(1, {
      title: '选择 Pictor 项目目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    expect(mocks.showOpenDialog).toHaveBeenNthCalledWith(2, {
      title: '导入 Pi Session JSONL',
      properties: ['openFile'],
      filters: [{ name: 'Pi Session', extensions: ['jsonl'] }],
    })
  })

  it('normalizes a selected export path while retaining save cancellation', async () => {
    mocks.showSaveDialog
      .mockResolvedValueOnce({ canceled: false, filePath: '/exports/history' })
      .mockResolvedValueOnce({ canceled: true, filePath: '' })

    await expect(
      invoke('workspace:pick-session-export', {
        format: 'jsonl',
        defaultFileName: 'history.jsonl',
      }),
    ).resolves.toEqual({ ok: true, value: '/exports/history.jsonl' })
    await expect(
      invoke('workspace:pick-session-export', {
        format: 'html',
        defaultFileName: 'history.html',
      }),
    ).resolves.toEqual({ ok: true, value: null })
  })

  it('reads selected image files through the Node file operation and reports I/O errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-ipc-images-'))
    roots.push(root)
    const imagePath = join(root, 'fixture.png')
    await writeFile(imagePath, Buffer.from('image data'))
    mocks.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [imagePath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [join(root, 'missing.png')] })

    await expect(invoke('workspace:pick-message-images')).resolves.toEqual({
      ok: true,
      value: [
        {
          data: Buffer.from('image data').toString('base64'),
          mimeType: 'image/png',
          name: 'fixture.png',
        },
      ],
    })
    await expect(invoke('workspace:pick-message-images')).resolves.toMatchObject({
      ok: false,
      error: { code: 'persistence-failed' },
    })
  })
})

describe('Plugin Manager command adapter', () => {
  it('does not execute an install command when the picker is cancelled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })

    await expect(invoke('plugin:install-local')).resolves.toMatchObject({ ok: true })
    expect(mocks.commandExecute).not.toHaveBeenCalled()
  })
})
