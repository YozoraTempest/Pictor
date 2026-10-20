import {
  Globe,
  MessagesSquare,
  Plus,
  Puzzle,
  Settings2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import type { PanelDescriptor } from '../../../../shared/bridge.js'

/**
 * One rendered panel. Built-in panels and plugin panels land in the same list,
 * so the side panel renders one shape and never branches on the source.
 */
export interface PanelEntry {
  id: string
  title: string
  description: string
  icon: LucideIcon
  source: 'builtin' | 'plugin'
  run: () => void
}

/** Icon names a plugin may use; anything else falls back to a neutral glyph. */
const ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  'messages-square': MessagesSquare,
  plus: Plus,
  puzzle: Puzzle,
  settings: Settings2,
  wrench: Wrench,
}

export function iconFor(name: string | undefined): LucideIcon {
  if (name === undefined) return Wrench
  return ICONS[name] ?? Wrench
}

/**
 * Built-in panels are declared here with the same descriptor shape plugins use;
 * the only difference is that their `run` is a local closure instead of a
 * command id, because they manipulate the workbench rather than the host.
 */
export function createBuiltinPanels(options: {
  createSession: () => void
  openSettings: () => void
}): PanelEntry[] {
  return [
    {
      id: 'session.new',
      title: '新建会话',
      description: '在当前项目中开一个新对话',
      icon: Plus,
      source: 'builtin',
      run: options.createSession,
    },
    {
      id: 'settings.open',
      title: '打开设置',
      description: '模型服务、插件与工作区偏好',
      icon: Settings2,
      source: 'builtin',
      run: options.openSettings,
    },
  ]
}

/**
 * Adapts plugin descriptors to entries. A plugin panel keeps its id, so a
 * contribution that collides with a built-in panel is dropped by the merge
 * instead of silently shadowing it.
 */
export function pluginPanelEntries(
  descriptors: readonly PanelDescriptor[],
  invoke: (id: string, title: string) => void,
): PanelEntry[] {
  return descriptors.map((descriptor) => ({
    id: descriptor.id,
    title: descriptor.title,
    description: descriptor.description ?? '',
    icon: iconFor(descriptor.icon),
    source: 'plugin',
    run: () => invoke(descriptor.id, descriptor.title),
  }))
}

/**
 * Built-ins win on id collisions: a plugin must not be able to replace the
 * workbench's own panels with a lookalike.
 */
export function mergePanels(
  builtin: readonly PanelEntry[],
  plugin: readonly PanelEntry[],
): PanelEntry[] {
  const taken = new Set(builtin.map((panel) => panel.id))
  return [...builtin, ...plugin.filter((panel) => !taken.has(panel.id))]
}
