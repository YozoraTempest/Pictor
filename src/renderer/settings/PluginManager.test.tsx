import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommandClient, CommandEvent } from '../../commands/index.js'
import { appInfoSchema } from '../../shared/app-info.js'
import type { PictorBridge } from '../../shared/desktop-bridge.js'
import { pluginManagerSnapshotSchema } from '../../shared/plugins.js'
import { PluginManager } from './PluginManager.js'

const snapshot = pluginManagerSnapshotSchema.parse({
  safeMode: false,
  restartRequired: false,
  items: [],
  issues: [],
})

const appInfo = appInfoSchema.parse({
  name: 'Pictor',
  version: '0.3.0',
  buildChannel: 'development',
  sourceCommit: null,
  platform: 'linux',
  arch: 'x64',
  distribution: 'unsupported-linux',
})

const now = new Date().toISOString()

function event(type: 'started' | 'completed', executionId: string): CommandEvent {
  if (type === 'started') {
    return {
      type,
      executionId,
      commandId: 'plugin.list',
      sequence: 0,
      at: now,
      context: { frontend: 'gui' },
    }
  }
  return {
    type,
    executionId,
    commandId: 'plugin.list',
    sequence: 1,
    at: now,
    result: {
      executionId,
      commandId: 'plugin.list',
      value: snapshot,
    },
  }
}

function createBridge(commands: CommandClient): PictorBridge {
  return {
    commands,
    notifyRendererReady: async () => ({ ok: true, value: null }),
    getAppInfo: async () => ({ ok: true, value: appInfo }),
    getPluginBootstrap: async () => ({ ok: true, value: { safeMode: false, plugins: [] } }),
    installLocalPlugin: async () => ({ ok: true, value: snapshot }),
    installDevelopmentPlugin: async () => ({ ok: true, value: snapshot }),
    installPiExtension: async () => ({ ok: true, value: snapshot }),
    installPiPackage: async () => ({ ok: true, value: snapshot }),
    pickProjectDirectory: async () => ({ ok: true, value: null }),
    pickSessionImport: async () => ({ ok: true, value: null }),
    pickSessionExport: async () => ({ ok: true, value: null }),
    pickMessageImages: async () => ({ ok: true, value: null }),
  }
}

describe('PluginManager command integration', () => {
  it('loads its production snapshot through the CommandClient transport', async () => {
    const executionId = '00000000-0000-4000-8000-000000000001'
    const execute = vi.fn(async () => ({ executionId, commandId: 'plugin.list' }))
    const subscribe = vi.fn((_id: string | undefined, listener: (value: CommandEvent) => void) => {
      listener(event('started', executionId))
      listener(event('completed', executionId))
      return vi.fn()
    })
    const commands: CommandClient = {
      list: vi.fn(async () => []),
      execute,
      cancel: vi.fn(async () => ({ executionId, accepted: false })),
      subscribe,
    }
    Object.defineProperty(window, 'pictor', {
      configurable: true,
      value: createBridge(commands),
    })

    render(<PluginManager rendererPluginStatuses={[]} />)

    await waitFor(() => expect(screen.getByText('0 个已登记扩展')).toBeVisible())
    expect(execute).toHaveBeenCalledWith('plugin.list', null, { frontend: 'gui' })
    expect(subscribe).toHaveBeenCalledWith(executionId, expect.any(Function))
  })
})
