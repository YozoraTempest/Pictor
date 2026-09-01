import { Info } from 'lucide-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommandClient } from '../commands/index.js'
import type { GuiPluginPicker } from '../shared/desktop-bridge.js'
import { GuiHostView, selectGuiHostView, validateGuiWorkbenchContributions } from './GuiHostView.js'
import {
  normalizeGuiSettingsSectionContributions,
  type GuiPluginStatus,
  type GuiSettingsSectionContribution,
  type GuiWorkbenchContribution,
} from './contract.js'

const commandClient = {} as CommandClient
const pluginPicker = {} as GuiPluginPicker

function workbench(id: string, pluginId: string, render = () => null): GuiWorkbenchContribution {
  return { id, pluginId, render }
}

function pluginStatus(
  id: string,
  effectiveState: GuiPluginStatus['effectiveState'],
  reason?: string,
): GuiPluginStatus {
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
    const onWorkbenchFailure = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <GuiHostView
          commandClient={commandClient}
          pluginPicker={pluginPicker}
          settingsSections={[]}
          guiPluginStatuses={[]}
          workbenches={[broken]}
          safeMode={false}
          onWorkbenchFailure={onWorkbenchFailure}
        />,
      )

      expect(await screen.findByRole('heading', { name: 'Pictor Shell' })).toBeInTheDocument()
      expect(screen.getByText('Workbench 加载失败')).toBeInTheDocument()
      expect(screen.getByText('render failed')).toBeInTheDocument()
      expect(consoleError).toHaveBeenCalled()
      expect(onWorkbenchFailure).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('rejects malformed Workbench contracts before mounting the host', () => {
    expect(() =>
      validateGuiWorkbenchContributions([{ id: '', pluginId: 'pictor.invalid', render: vi.fn() }]),
    ).toThrow('requires id and pluginId')
  })

  it('sorts settings by order and identity, and keeps the lexicographically first owner', () => {
    const section = (
      id: string,
      owner: string,
      order?: number,
    ): GuiSettingsSectionContribution => ({
      id,
      owner,
      label: id,
      icon: Info,
      ...(order === undefined ? {} : { order }),
      render: () => null,
    })

    const normalized = normalizeGuiSettingsSectionContributions([
      section('same', 'zeta', 10),
      section('later', 'owner', 20),
      section('same', 'alpha', 10),
      { ...section('invalid', 'owner'), id: ' invalid' },
      { ...section('model', 'rogue') },
      null as unknown as GuiSettingsSectionContribution,
    ])

    expect(normalized.map(({ id, owner }) => `${id}:${owner}`)).toEqual([
      'same:alpha',
      'later:owner',
    ])
  })

  it('does not let an invalid settings contribution prevent the Workbench', async () => {
    const valid = {
      id: 'pictor.valid.settings',
      owner: 'pictor.valid',
      label: 'Valid',
      icon: Info,
      render: () => null,
    } satisfies GuiSettingsSectionContribution
    const broken = { ...valid, id: '' } as GuiSettingsSectionContribution

    const hostWorkbench: GuiWorkbenchContribution = {
      id: 'delegate',
      pluginId: 'pictor.delegate',
      render: (context) => <div>{context.settingsSections.map((item) => item.label)}</div>,
    }

    render(
      <GuiHostView
        commandClient={commandClient}
        pluginPicker={pluginPicker}
        settingsSections={[broken, valid]}
        guiPluginStatuses={[]}
        workbenches={[hostWorkbench]}
        safeMode={false}
      />,
    )

    expect(await screen.findByText('Valid')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pictor Shell' })).not.toBeInTheDocument()
  })
})
