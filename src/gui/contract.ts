import type { ReactNode } from 'react'

import type { CommandClient } from '../commands/index.js'
import { ContributionPoint } from '../kernel/module.js'
import type { PluginStatus } from '../plugin/host.js'
import type { GuiPluginPicker } from '../shared/desktop-bridge.js'
import type { SettingsSection } from '../modules/shell/settings.js'

export interface GuiWorkbenchContext {
  readonly commandClient: CommandClient
  readonly pluginPicker: GuiPluginPicker
  readonly settingsSections: readonly SettingsSection[]
  readonly guiPluginStatuses: readonly PluginStatus[]
}

export interface GuiWorkbenchContribution {
  readonly id: string
  readonly pluginId: string
  render(context: GuiWorkbenchContext): ReactNode
}

export const guiWorkbenchContributions = new ContributionPoint<GuiWorkbenchContribution>(
  'gui.workbenches',
)
