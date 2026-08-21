import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { ContributionPoint } from '../../kernel/module.js'

export interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
  render(): ReactNode
}

export const settingsSectionContributions = new ContributionPoint<SettingsSection>(
  'shell.settings-sections',
)
