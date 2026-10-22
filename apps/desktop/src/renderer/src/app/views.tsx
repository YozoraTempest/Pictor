import { House, Settings2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { SettingsView } from '../features/settings/SettingsView.js'
import {
  WorkspaceLeading,
  WorkspaceTitle,
  WorkspaceTrailing,
} from '../features/workspace/WorkspaceHeader.js'
import { WorkspaceView } from '../features/workspace/WorkspaceView.js'

/**
 * One top-level destination.
 *
 * A view owns everything inside the frame: columns, resizers, scroll containers,
 * and its own share of the title bar. The shell only draws the rail and the
 * frame, so adding a destination is one entry here instead of an edit in five
 * files.
 */
export interface AppViewDescriptor<Id extends string = string> {
  id: Id
  label: string
  /** Rail tooltip and the view menu's secondary line. */
  description: string
  icon: LucideIcon
  /** `secondary` pins the entry to the bottom of the rail. */
  group: 'primary' | 'secondary'
  order: number
  render: () => ReactNode
  /** Centred in the title bar; omit it to show no title. */
  title?: () => ReactNode
  /** Left toolbar: the view's own controls, before the injected global tools. */
  leading?: () => ReactNode
  /** Right toolbar: the view's own controls, just inside the window buttons. */
  trailing?: () => ReactNode
  /**
   * Which side the shared tools (history, overflow menu) join. Defaults to the
   * left; a view that wants them elsewhere only changes this field.
   */
  tools?: 'leading' | 'trailing' | 'none'
  /** Accelerator shown in the view menu; binding it stays with the shortcuts. */
  shortcut?: string
  /**
   * Reserved for views a plugin contributes later: the command that opens it.
   * Built-in views leave it undefined, and nothing reads it yet.
   */
  command?: string
}

const VIEWS = [
  {
    id: 'home',
    label: '首页',
    description: '会话与项目',
    icon: House,
    group: 'primary',
    order: 0,
    render: () => <WorkspaceView />,
    title: () => <WorkspaceTitle />,
    leading: () => <WorkspaceLeading />,
    trailing: () => <WorkspaceTrailing />,
  },
  {
    id: 'settings',
    label: '设置',
    description: '偏好与模型服务',
    icon: Settings2,
    group: 'secondary',
    order: 0,
    render: () => <SettingsView />,
    title: () => '设置',
    shortcut: 'Ctrl+,',
  },
] as const satisfies readonly AppViewDescriptor[]

export type AppView = (typeof VIEWS)[number]['id']

export const APP_VIEWS: ReadonlyArray<AppViewDescriptor<AppView>> = VIEWS

/** Views in declared order; every consumer renders this list, never its own. */
export function sortedViews(): ReadonlyArray<AppViewDescriptor<AppView>> {
  return [...APP_VIEWS].sort((a, b) => a.order - b.order)
}

/** Where the app starts when nothing else is known. */
export const DEFAULT_VIEW: AppView = 'home'

/**
 * The descriptor for `id`, falling back to the first declared view.
 *
 * Callers render a frame on every frame; an unknown id should still produce a
 * view rather than an empty window, so the fallback is part of the contract.
 */
export function findView(id: string): AppViewDescriptor<AppView> {
  return APP_VIEWS.find((entry) => entry.id === id) ?? APP_VIEWS[0] ?? VIEWS[0]
}
