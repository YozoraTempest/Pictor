import { Blocks, Boxes, House, Settings2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { KernelInfo } from '../../../shared/bridge.js'
import { kernelViewId } from './kernel-scope.js'

import { ExtensionsView } from '../features/extensions/ExtensionsView.js'
import { iconFor } from '../lib/icons.js'
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

/**
 * A view id, as `ui-store` holds it.
 *
 * Kernel pages are named after the kernel they hold (`kernel:pi`), so the set of
 * destinations is a function of what is mounted rather than a list written here.
 */
export type AppView = string

/** Where the app starts when nothing else is known. */
export const DEFAULT_VIEW: AppView = 'home'

/** Every conversation starts here, whatever kernel ends up running it. */
const HOME_VIEW: AppViewDescriptor = {
  id: DEFAULT_VIEW,
  label: '首页',
  description: '开始一个新话题',
  icon: House,
  group: 'primary',
  order: 0,
  /**
   * No sessions and no kernel: a conversation starts here, and once it has a kernel
   * it lives on that kernel's page. One list for every kernel would have to describe
   * runtimes that disagree about almost everything.
   */
  render: () => <WorkspaceView />,
  title: () => <WorkspaceTitle />,
  leading: () => <WorkspaceLeading />,
  trailing: () => <WorkspaceTrailing />,
  shortcut: 'Ctrl+1',
}

/**
 * What can be added to the app.
 *
 * Above settings, and separate from it: a plugin, a skill or an MCP server is something
 * you install and switch on, not a preference you set once. Three surfaces that answer
 * the same question — 「还能加什么？」 — belong on one page.
 */
const EXTENSIONS_VIEW: AppViewDescriptor = {
  id: 'extensions',
  label: '拓展',
  description: '插件、技能与 MCP',
  icon: Blocks,
  group: 'secondary',
  order: 0,
  render: () => <ExtensionsView />,
  // No title-bar text: the page's own heading names it, and two 「拓展」 on screen would
  // be the same word twice — the exact thing this page was made to avoid.
}

/** Preferences are not about kernels, so the entry is not either. */
const SETTINGS_VIEW: AppViewDescriptor = {
  id: 'settings',
  label: '设置',
  description: '偏好与模型服务',
  icon: Settings2,
  group: 'secondary',
  order: 1,
  render: () => <SettingsView />,
  title: () => '设置',
  shortcut: 'Ctrl+,',
}

/**
 * Every destination, given what this machine can run.
 *
 * Home first, one page per mounted kernel after it, settings pinned to the bottom.
 * The list is built on demand because the kernels are: turning a kernel off takes its
 * page away, and installing one adds a page without an edit here.
 */
export function viewsFor(kernels: readonly KernelInfo[]): AppViewDescriptor[] {
  const pages = kernels.map((kernel, index): AppViewDescriptor => ({
    id: kernelViewId(kernel.id),
    label: kernel.label,
    description: `${kernel.label} 的会话`,
    // The kernel names its icon; the window owns the vocabulary. An installed kernel
    // the build has never heard of still gets a page, a generic icon and a number.
    icon: iconFor(kernel.icon, Boxes),
    group: 'primary',
    order: index + 1,
    render: () => <WorkspaceView kernelId={kernel.id} />,
    title: () => <WorkspaceTitle />,
    leading: () => <WorkspaceLeading />,
    trailing: () => <WorkspaceTrailing />,
    shortcut: `Ctrl+${String(index + 2)}`,
  }))
  return [HOME_VIEW, ...pages, EXTENSIONS_VIEW, SETTINGS_VIEW]
}

/** The destinations in the order the rail shows them. */
export function sortedViews(kernels: readonly KernelInfo[]): AppViewDescriptor[] {
  return viewsFor(kernels).sort((a, b) => a.order - b.order)
}

/**
 * The descriptor for `id`, falling back to home.
 *
 * Callers render a frame on every frame; an id whose kernel is no longer mounted has
 * to produce a view rather than an empty window, and home is the one that can always
 * be shown.
 */
export function findView(id: string, kernels: readonly KernelInfo[]): AppViewDescriptor {
  return viewsFor(kernels).find((entry) => entry.id === id) ?? HOME_VIEW
}
