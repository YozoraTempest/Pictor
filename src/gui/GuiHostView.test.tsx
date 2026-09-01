import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommandClient } from '../commands/index.js'
import type { GuiPluginPicker } from '../shared/desktop-bridge.js'
import type { PluginStatus } from '../plugin/host.js'
import { GuiHostView, selectGuiHostView, validateGuiWorkbenchContributions } from './GuiHostView.js'
import type { GuiWorkbenchContribution } from './contract.js'

const commandClient = {} as CommandClient
const pluginPicker = {} as GuiPluginPicker

function workbench(id: string, pluginId: string, render = () => null): GuiWorkbenchContribution {
  return { id, pluginId, render }
}

function pluginStatus(
  id: string,
  effectiveState: PluginStatus['effectiveState'],
  reason?: string,
): PluginStatus {
  return {
    id,
    version: '1.0.0',
    desiredState: 'enabled',
    effectiveState,
    ...(reason ? { reason } : {}),
  }
}

describe('GuiHostView', () => {
  it('selects Shell for safe mode and never needs a Workbench factory', () => {
    expect(selectGuiHostView([workbench('delegate', 'pictor.delegate')], [], true)).toEqual({
      kind: 'shell',
      state: { kind: 'safe-mode' },
    })
  })

  it('selects Shell when there are no Workbenches and reports failed Plugins', () => {
    expect(
      selectGuiHostView([], [pluginStatus('pictor.broken', 'failed', 'activate failed')], false),
    ).toEqual({
      kind: 'shell',
      state: {
        kind: 'plugin-failure',
        failures: [pluginStatus('pictor.broken', 'failed', 'activate failed')],
      },
    })
    expect(selectGuiHostView([], [], false)).toEqual({
      kind: 'shell',
      state: { kind: 'no-workbench' },
    })
  })

  it('renders the only Workbench and reports every conflicting owner deterministically', () => {
    const single = workbench('delegate', 'pictor.delegate')
    expect(selectGuiHostView([single], [], false)).toEqual({
      kind: 'workbench',
      workbench: single,
    })
    expect(
      selectGuiHostView(
        [workbench('zeta', 'pictor.zeta'), workbench('alpha', 'pictor.alpha')],
        [],
        false,
      ),
    ).toEqual({
      kind: 'shell',
      state: {
        kind: 'workbench-conflict',
        workbenches: [
          { id: 'alpha', pluginId: 'pictor.alpha' },
          { id: 'zeta', pluginId: 'pictor.zeta' },
        ],
      },
    })
  })

  it('contains a Workbench render error inside the GUI Host and falls back to Shell', async () => {
    const broken = workbench('delegate', 'pictor.delegate', () => {
      throw new Error('render failed')
    })
    render(
      <GuiHostView
        commandClient={commandClient}
        pluginPicker={pluginPicker}
        settingsSections={[]}
        rendererPluginStatuses={[]}
        workbenches={[broken]}
        safeMode={false}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Pictor Shell' })).toBeInTheDocument()
    expect(screen.getByText('Workbench 加载失败')).toBeInTheDocument()
    expect(screen.getByText('render failed')).toBeInTheDocument()
  })

  it('rejects malformed Workbench contracts before mounting the host', () => {
    expect(() =>
      validateGuiWorkbenchContributions([{ id: '', pluginId: 'pictor.invalid', render: vi.fn() }]),
    ).toThrow('requires id and pluginId')
  })
})
