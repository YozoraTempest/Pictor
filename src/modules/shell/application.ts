import type { ReactNode } from 'react'

import { ContributionPoint } from '../../kernel/module.js'
import type { PluginStatus } from '../../plugin/host.js'
import type { SettingsSection } from './settings.js'

export interface ShellApplicationContext {
  settingsSections: readonly SettingsSection[]
  rendererPluginStatuses: readonly PluginStatus[]
}

export interface ShellApplication {
  id: string
  render(context: ShellApplicationContext): ReactNode
}

export const shellApplicationContributions = new ContributionPoint<ShellApplication>(
  'shell.applications',
)
