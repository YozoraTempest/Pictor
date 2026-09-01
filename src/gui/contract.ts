import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import type { CommandClient } from '../commands/index.js'
import { ContributionPoint } from '../kernel/module.js'
import type { GuiPluginPicker } from '../shared/desktop-bridge.js'

export type GuiPluginDesiredState = 'enabled' | 'disabled' | 'removed'
export type GuiPluginEffectiveState = 'active' | 'disabled' | 'blocked' | 'failed'

export interface GuiPluginStatus {
  readonly id: string
  readonly version: string
  readonly desiredState: GuiPluginDesiredState
  readonly effectiveState: GuiPluginEffectiveState
  readonly reason?: string
}

export interface GuiSettingsSectionContext {
  readonly commandClient: CommandClient
  readonly pluginPicker: GuiPluginPicker
  readonly guiPluginStatuses: readonly GuiPluginStatus[]
}

export interface GuiSettingsSectionContribution {
  readonly id: string
  readonly owner: string
  readonly label: string
  readonly icon: LucideIcon
  readonly order?: number
  render(context: GuiSettingsSectionContext): ReactNode
}

export const guiSettingsSectionContributions =
  new ContributionPoint<GuiSettingsSectionContribution>('gui.settings-sections')

export interface GuiWorkbenchContext extends GuiSettingsSectionContext {
  readonly settingsSections: readonly GuiSettingsSectionContribution[]
}

export interface GuiWorkbenchContribution {
  readonly id: string
  readonly pluginId: string
  render(context: GuiWorkbenchContext): ReactNode
}

export const guiWorkbenchContributions = new ContributionPoint<GuiWorkbenchContribution>(
  'gui.workbenches',
)

/**
 * Returns the deterministic, host-safe set of settings sections.
 *
 * The GUI Host treats a section identity as global. When multiple Plugins
 * contribute the same identity, the lexicographically first owner wins after
 * ordering; malformed contributions are ignored instead of taking down the
 * Host. This keeps a product Plugin failure local to its own settings page.
 */
export function normalizeGuiSettingsSectionContributions(
  sections: readonly GuiSettingsSectionContribution[],
): readonly GuiSettingsSectionContribution[] {
  const candidates = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => isValidGuiSettingsSection(section))
    .sort((left, right) => {
      const leftOrder = finiteOrder(left.section.order)
      const rightOrder = finiteOrder(right.section.order)
      return (
        leftOrder - rightOrder ||
        compareText(left.section.id, right.section.id) ||
        compareText(left.section.owner, right.section.owner) ||
        left.index - right.index
      )
    })

  const identities = new Set<string>()
  return candidates.flatMap(({ section }) => {
    if (identities.has(section.id)) return []
    identities.add(section.id)
    return [section]
  })
}

function isValidGuiSettingsSection(section: GuiSettingsSectionContribution): boolean {
  return (
    section !== null &&
    typeof section === 'object' &&
    typeof section.id === 'string' &&
    section.id.length > 0 &&
    section.id.trim() === section.id &&
    section.id !== 'model' &&
    typeof section.owner === 'string' &&
    section.owner.length > 0 &&
    section.owner.trim() === section.owner &&
    typeof section.label === 'string' &&
    section.label.trim().length > 0 &&
    section.icon != null &&
    typeof section.render === 'function'
  )
}

function finiteOrder(order: number | undefined): number {
  return typeof order === 'number' && Number.isFinite(order) ? order : 0
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
