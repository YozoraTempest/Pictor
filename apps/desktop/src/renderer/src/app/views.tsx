import { House, Settings2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { SettingsView } from '../features/settings/SettingsView.js'
import { WorkspaceBreadcrumb } from '../features/workspace/WorkspaceBreadcrumb.js'
import { WorkspaceView } from '../features/workspace/WorkspaceView.js'

/**
 * One top-level destination.
 *
 * A view owns everything inside the frame: columns, resizers, scroll containers.
 * The shell only draws the rail and the title bar, so adding a destination is one
 * entry here instead of an edit in five files.
 */
export interface AppViewDescriptor {
  id: string
  label: string
  /** Rail tooltip and the command palette's secondary line. */
  description: string
  icon: LucideIcon
  /** `secondary` pins the entry to the bottom of the rail. */
  group: 'primary' | 'secondary'
  order: number
  render: () => ReactNode
  /** What the title bar shows for this view; omit it to show nothing. */
  header?: () => ReactNode
  /** Accelerator shown in the view menu; binding it stays with the shortcuts. */
  shortcut?: string
  /**
   * Reserved for views a plugin contributes later: the command that opens it.
   * Built-in views leave it undefined, and nothing reads it yet.
   */
  command?: string
}

export const APP_VIEWS = [
  {
    id: 'home',
    label: '首页',
    description: '会话与项目',
    icon: House,
    group: 'primary',
    order: 0,
    render: () => <WorkspaceView />,
    header: () => <WorkspaceBreadcrumb />,
  },
  {
    id: 'settings',
    label: '设置',
    description: '偏好与模型服务',
    icon: Settings2,
    group: 'secondary',
    order: 0,
    render: () => <SettingsView />,
    header: () => '设置',
    shortcut: 'Ctrl+,',
  },
] as const satisfies readonly AppViewDescriptor[]

export type AppViewEntry = (typeof APP_VIEWS)[number]

export type AppView = AppViewEntry['id']

/** Views in declared order; every consumer renders this list, never its own. */
export function sortedViews(): AppViewEntry[] {
  return [...APP_VIEWS].sort((a, b) => a.order - b.order)
}

/** Where the app starts when nothing else is known. */
export const DEFAULT_VIEW: AppView = 'home'
