// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommandClient, CommandEvent } from '../../src/commands/index.js'
import type { GuiPluginPicker } from '../../src/shared/desktop-bridge.js'
import { pluginManagerSnapshotSchema } from '../../src/shared/plugins.js'
import type { PluginManagerSnapshot } from '../../src/shared/plugins.js'
import { PluginManager } from './PluginManager.js'

const snapshot = pluginManagerSnapshotSchema.parse({
  safeMode: false,
  restartRequired: false,
  items: [],
  issues: [],
})

const creationModeSnapshot = pluginManagerSnapshotSchema.parse({
  creationMode: true,
  safeMode: false,
  restartRequired: true,
  items: [
    {
      kind: 'pictor-plugin',
      id: 'example.creation-plugin',
      name: 'Creation Plugin',
      version: '1.0.0',
      source: 'development:/tmp/creation-plugin',
      desiredState: 'enabled',
      effectiveState: 'pending-restart',
      reason: 'Restart Pictor to apply this change',
      canRestore: false,
    },
    {
      kind: 'pictor-plugin',
      id: 'example.live-plugin',
      name: 'Live Plugin',
      version: '1.0.0',
      source: 'development:/tmp/live-plugin',
      desiredState: 'enabled',
      effectiveState: 'active',
      reason: null,
      canRestore: false,
    },
  ],
  issues: [],
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

function completedEvent(executionId: string, value: PluginManagerSnapshot): CommandEvent {
  return {
    type: 'completed',
    executionId,
    commandId: 'plugin.list',
    sequence: 1,
    at: now,
    result: { executionId, commandId: 'plugin.list', value },
  }
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

describe('PluginManager command integration', () => {
  it('loads its production snapshot through the public CommandClient context', async () => {
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
    const pluginPicker: GuiPluginPicker = {
      pickPlugin: vi.fn(async (source) => ({
        ok: true as const,
        value: { source, path: null },
      })),
    }

    render(
      <PluginManager commandClient={commands} pluginPicker={pluginPicker} guiPluginStatuses={[]} />,
    )

    await waitFor(() => expect(screen.getByText('0 个已登记扩展')).toBeVisible())
    expect(execute).toHaveBeenCalledWith('plugin.list', null, { frontend: 'gui' })
    expect(subscribe).toHaveBeenCalledWith(executionId, expect.any(Function))
  })

  it('keeps the picker as a selection adapter and sends the path through plugin.install', async () => {
    const executionId = '00000000-0000-4000-8000-000000000002'
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
    const pickPlugin = vi.fn(async () => ({
      ok: true as const,
      value: {
        source: 'development' as const,
        path: '/tmp/development-plugin',
      },
    }))

    render(
      <PluginManager
        commandClient={commands}
        pluginPicker={{ pickPlugin }}
        guiPluginStatuses={[]}
      />,
    )
    await waitFor(() => expect(screen.getByText('0 个已登记扩展')).toBeVisible())

    await click(screen.getByRole('button', { name: 'Development Plugin' }))
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        'plugin.install',
        { source: 'development', path: '/tmp/development-plugin' },
        { frontend: 'gui' },
      ),
    )
    expect(pickPlugin).toHaveBeenCalledWith('development')
  })

  it('explains automatic Plugin reassembly while Creation Mode is active', async () => {
    const executionId = '00000000-0000-4000-8000-000000000003'
    const commands: CommandClient = {
      list: vi.fn(async () => []),
      execute: vi.fn(async () => ({ executionId, commandId: 'plugin.list' })),
      cancel: vi.fn(async () => ({ executionId, accepted: false })),
      subscribe: vi.fn((_id, listener) => {
        listener(event('started', executionId))
        listener(completedEvent(executionId, creationModeSnapshot))
        return vi.fn()
      }),
    }

    render(
      <PluginManager
        commandClient={commands}
        pluginPicker={{ pickPlugin: vi.fn() }}
        guiPluginStatuses={[]}
      />,
    )

    expect(await screen.findByText(/创造模式已开启/)).toBeVisible()
    expect(screen.getByText('正在等待创造模式重新装配 Plugin')).toBeVisible()
    expect(screen.getByText('创造模式正在重新装配')).toBeVisible()
    expect(screen.getByText('创造模式 · live source')).toBeVisible()
    expect(screen.queryByText('Restart Pictor to apply this change')).not.toBeInTheDocument()
  })
})
