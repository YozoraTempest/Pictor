import { Boxes, Settings2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { KernelInfo } from '../../main/bridge.js'
import { arsSettingsViewId, kernelViewId } from '../kernel-scope.js'

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

/**
 * Where the app starts.
 *
 * There is no home page: the one engine's page is where a conversation starts and where
 * the open one is drawn, so "nothing chosen yet" and "the engine's page" are the same
 * place. The id is derived from the mounted engine rather than written here, because the
 * rail is.
 */
export function defaultView(kernels: readonly KernelInfo[]): AppView {
  const first = kernels[0]
  return first === undefined ? ARS_SETTINGS_FALLBACK : kernelViewId(first.id)
}

/** Drawn when no engine is mounted at all; the window still has to show something. */
const ARS_SETTINGS_FALLBACK = 'settings'

/**
 * Every destination, given what this machine can run.
 *
 * Two entries, both belonging to the engine: its page, and its settings — which is also
 * where 拓展 lives, because a plugin, a skill or an MCP server is something you add to
 * *this* engine, not a preference of the window. There is no home page: the engine's page
 * is where a conversation starts.
 *
 * The list is built from what is mounted rather than written here, so a second engine would
 * appear without an edit if one ever ships again.
 */
export function viewsFor(kernels: readonly KernelInfo[]): AppViewDescriptor[] {
  const pages = kernels.map((kernel, index): AppViewDescriptor => ({
    id: kernelViewId(kernel.id),
    label: kernel.label,
    description: `${kernel.label} 的会话`,
    // The engine names its icon; the window owns the vocabulary.
    icon: iconFor(kernel.icon, Boxes),
    group: 'primary',
    order: index * 2,
    render: () => <WorkspaceView kernelId={kernel.id} />,
    title: () => <WorkspaceTitle />,
    leading: () => <WorkspaceLeading />,
    trailing: () => <WorkspaceTrailing />,
    shortcut: `Ctrl+${String(index + 1)}`,
  }))
  const settings = kernels.map((kernel, index): AppViewDescriptor => ({
    id: arsSettingsViewId(kernel.id),
    label: `${kernel.label} 设置`,
    description: '运行时、拓展与偏好',
    icon: Settings2,
    group: 'primary',
    order: index * 2 + 1,
    render: () => <SettingsView />,
    title: () => `${kernel.label} 设置`,
  }))

  return [...pages, ...settings]
}

/** The destinations in the order the rail shows them. */
export function sortedViews(kernels: readonly KernelInfo[]): AppViewDescriptor[] {
  return viewsFor(kernels).sort((a, b) => a.order - b.order)
}

/**
 * The descriptor for `id`, falling back to the engine's page.
 *
 * Callers render a frame on every frame; an id whose engine is no longer mounted still has
 * to produce a view rather than an empty window.
 */
export function findView(id: string, kernels: readonly KernelInfo[]): AppViewDescriptor {
  const views = viewsFor(kernels)
  return views.find((entry) => entry.id === id) ?? views[0] ?? MISSING_VIEW
}

/** Drawn when nothing is mounted at all: an engine that failed to load, in words. */
const MISSING_VIEW: AppViewDescriptor = {
  id: 'missing',
  label: '没有引擎',
  description: 'dsh 没有装载',
  icon: Boxes,
  group: 'primary',
  order: 0,
  render: () => <p className="p-6 text-sm text-muted">dsh 没有装载。看日志里启动失败的那一行。</p>,
  title: () => '没有引擎',
}
