import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  CommandFailure,
  type CommandClient,
  type CommandDescriptor,
  type CommandEvent,
} from '../commands/index.js'
import { pluginManagerSnapshotSchema } from '../shared/plugins.js'
import type { GuiPluginPicker } from '../shared/desktop-bridge.js'
import { executeShellCommand, GUI_RECOVERY_COMMAND_IDS, PictorShell } from './PictorShell.js'

const now = new Date().toISOString()
const snapshot = pluginManagerSnapshotSchema.parse({
  safeMode: false,
  restartRequired: false,
  items: [
    {
      kind: 'pictor-plugin',
      id: 'pictor.agent-workspace',
      name: 'Agent Workspace',
      version: '0.3.1',
      source: 'bundled:pictor.agent-workspace',
      desiredState: 'enabled',
      effectiveState: 'active',
      reason: null,
      canRestore: false,
    },
  ],
  issues: [],
})

function createCommandClient(
  descriptors: readonly string[] = GUI_RECOVERY_COMMAND_IDS,
  output = snapshot,
): {
  client: CommandClient
  execute: ReturnType<typeof vi.fn>
} {
  const executions = new Map<string, string>()
  let nextId = 1
  const execute = vi.fn(async (commandId: string, _input: unknown, _context: unknown) => {
    const executionId = `00000000-0000-4000-8000-${nextId.toString().padStart(12, '0')}`
    nextId += 1
    executions.set(executionId, commandId)
    return { executionId, commandId }
  })
  const subscribe = vi.fn(
    (executionId: string | undefined, listener: (event: CommandEvent) => void) => {
      if (!executionId) return () => undefined
      const commandId = executions.get(executionId) ?? 'plugin.list'
      listener({
        type: 'started',
        executionId,
        commandId,
        sequence: 0,
        at: now,
        context: { frontend: 'shell' },
      })
      listener({
        type: 'completed',
        executionId,
        commandId,
        sequence: 1,
        at: now,
        result: { executionId, commandId, value: output },
      })
      return () => undefined
    },
  )
  return {
    client: {
      list: vi.fn(async (): Promise<readonly CommandDescriptor[]> =>
        descriptors.map((id) => ({
          id,
          title: id,
          description: `${id} description`,
          inputSchema: { type: 'null' as const },
          execution: { cancellable: false, recoverySafe: true },
        })),
      ),
      execute,
      cancel: vi.fn(async (executionId: string) => ({ executionId, accepted: false })),
      subscribe,
    },
    execute,
  }
}

const shellState = {
  kind: 'no-workbench' as const,
}

describe('PictorShell', () => {
  it('lists only the Core recovery allowlist and uses shell context', async () => {
    const { client, execute } = createCommandClient([
      ...GUI_RECOVERY_COMMAND_IDS,
      'plugin.untrusted',
    ])
    const pluginPicker: GuiPluginPicker = { pickPlugin: vi.fn() }

    render(
      <PictorShell
        commandClient={client}
        pluginPicker={pluginPicker}
        rendererPluginStatuses={[]}
        safeMode={false}
        state={shellState}
      />,
    )

    await screen.findByText('plugin.list description')
    expect(client.list).toHaveBeenCalledWith({ recoverySafe: true })
    expect(screen.queryByText('plugin.untrusted description')).not.toBeInTheDocument()
    expect(execute).toHaveBeenCalledWith('plugin.list', null, { frontend: 'shell' })
  })

  it('sends picker selections to plugin.install and reports restart-required state', async () => {
    const { client, execute } = createCommandClient()
    const pluginPicker: GuiPluginPicker = {
      pickPlugin: vi.fn(async (source) => ({
        ok: true as const,
        value: { source, path: '/tmp/renderer-plugin' },
      })),
    }
    render(
      <PictorShell
        commandClient={client}
        pluginPicker={pluginPicker}
        rendererPluginStatuses={[]}
        safeMode={false}
        state={shellState}
      />,
    )

    await screen.findByText('plugin.install description')
    await screen.getByRole('button', { name: '安装本地 GUI Plugin' }).click()
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        'plugin.install',
        { source: 'local', path: '/tmp/renderer-plugin' },
        { frontend: 'shell' },
      ),
    )
    expect(pluginPicker.pickPlugin).toHaveBeenCalledWith('local')
    expect(screen.getByText('Plugin 安装意图已记录；重启 Pictor 后生效。')).toBeInTheDocument()
  })

  it('routes enable, disable, remove, and Bundled restore through shell commands', async () => {
    const lifecycleSnapshot = pluginManagerSnapshotSchema.parse({
      ...snapshot,
      items: [
        ...snapshot.items,
        {
          kind: 'pictor-plugin',
          id: 'pictor.disabled-plugin',
          name: 'Disabled Plugin',
          version: '0.3.0',
          source: 'bundled:pictor.disabled-plugin',
          desiredState: 'disabled',
          effectiveState: 'disabled',
          reason: 'Disabled by user',
          canRestore: false,
        },
        {
          kind: 'pictor-plugin',
          id: 'pictor.removed-plugin',
          name: 'Removed Plugin',
          version: '0.3.0',
          source: 'bundled:pictor.removed-plugin',
          desiredState: 'removed',
          effectiveState: 'pending-restart',
          reason: 'Restart Pictor to apply this change',
          canRestore: true,
        },
      ],
    })
    const { client, execute } = createCommandClient(GUI_RECOVERY_COMMAND_IDS, lifecycleSnapshot)

    render(
      <PictorShell
        commandClient={client}
        pluginPicker={{ pickPlugin: vi.fn() }}
        rendererPluginStatuses={[]}
        safeMode={false}
        state={shellState}
      />,
    )

    await waitFor(() =>
      expect(
        screen.getByLabelText('Plugin 恢复').querySelector('.pictor-shell__plugin-row:last-child'),
      ).toBeTruthy(),
    )
    await screen.getByRole('button', { name: '禁用 pictor.agent-workspace' }).click()
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        'plugin.disable',
        { kind: 'pictor-plugin', id: 'pictor.agent-workspace' },
        { frontend: 'shell' },
      ),
    )
    await screen.getByRole('button', { name: '启用 pictor.disabled-plugin' }).click()
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        'plugin.enable',
        { kind: 'pictor-plugin', id: 'pictor.disabled-plugin' },
        { frontend: 'shell' },
      ),
    )
    await screen.getByRole('button', { name: '恢复' }).click()
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        'plugin.restore',
        { id: 'pictor.removed-plugin' },
        { frontend: 'shell' },
      ),
    )
    await screen.getByRole('button', { name: '移除 pictor.agent-workspace' }).click()

    await waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        'plugin.disable',
        { kind: 'pictor-plugin', id: 'pictor.agent-workspace' },
        { frontend: 'shell' },
      )
      expect(execute).toHaveBeenCalledWith(
        'plugin.enable',
        { kind: 'pictor-plugin', id: 'pictor.disabled-plugin' },
        { frontend: 'shell' },
      )
      expect(execute).toHaveBeenCalledWith(
        'plugin.restore',
        { id: 'pictor.removed-plugin' },
        { frontend: 'shell' },
      )
      expect(execute).toHaveBeenCalledWith(
        'plugin.remove',
        { kind: 'pictor-plugin', id: 'pictor.agent-workspace', deleteData: false },
        { frontend: 'shell' },
      )
    })
  })

  it('renders only structured command failures and rejects non-recovery commands', async () => {
    const client: CommandClient = {
      list: vi.fn(async () => []),
      execute: vi.fn(async () => {
        throw new CommandFailure({ code: 'handler-failed', message: 'structured failure' })
      }),
      cancel: vi.fn(async (executionId: string) => ({ executionId, accepted: false })),
      subscribe: vi.fn(() => () => undefined),
    }

    await expect(
      executeShellCommand(client, 'plugin.list', null, pluginManagerSnapshotSchema),
    ).resolves.toEqual({ ok: false, error: 'structured failure' })
    await expect(
      executeShellCommand(client, 'plugin.untrusted', null, pluginManagerSnapshotSchema),
    ).resolves.toEqual({ ok: false, error: '该命令不在 Pictor Shell 恢复白名单中' })
    expect(client.execute).toHaveBeenCalledTimes(1)
  })
})
