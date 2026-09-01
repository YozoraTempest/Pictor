import { Component, type ErrorInfo, type ReactNode } from 'react'

import type { PluginStatus } from '../plugin/host.js'
import { sanitizeGuiDiagnostic } from './diagnostics.js'
import { PictorShell, type GuiWorkbenchReference, type PictorShellState } from './PictorShell.js'
import type { GuiWorkbenchContext, GuiWorkbenchContribution } from './contract.js'

export type GuiHostSelection =
  | { readonly kind: 'workbench'; readonly workbench: GuiWorkbenchContribution }
  | { readonly kind: 'shell'; readonly state: PictorShellState }

export interface GuiHostViewProps extends GuiWorkbenchContext {
  readonly workbenches: readonly GuiWorkbenchContribution[]
  readonly safeMode: boolean
}

export function validateGuiWorkbenchContributions(
  workbenches: readonly GuiWorkbenchContribution[],
): readonly GuiWorkbenchContribution[] {
  for (const workbench of workbenches) {
    if (!workbench.id.trim() || !workbench.pluginId.trim()) {
      throw new Error('GUI Workbench Contribution requires id and pluginId')
    }
    if (typeof workbench.render !== 'function') {
      throw new Error(`GUI Workbench Contribution has no renderer: ${workbench.id}`)
    }
  }
  return workbenches
}

export function selectGuiHostView(
  workbenches: readonly GuiWorkbenchContribution[],
  rendererPluginStatuses: readonly PluginStatus[],
  safeMode: boolean,
): GuiHostSelection {
  if (safeMode) return { kind: 'shell', state: { kind: 'safe-mode' } }

  const ordered = [...workbenches].sort(compareWorkbench)
  if (ordered.length === 0) {
    const failures = rendererPluginStatuses
      .filter((status) => status.effectiveState === 'failed')
      .sort((left, right) => compareText(left.id, right.id))
    return failures.length > 0
      ? { kind: 'shell', state: { kind: 'plugin-failure', failures } }
      : { kind: 'shell', state: { kind: 'no-workbench' } }
  }
  if (ordered.length > 1) {
    return {
      kind: 'shell',
      state: {
        kind: 'workbench-conflict',
        workbenches: ordered.map(toWorkbenchReference),
      },
    }
  }
  return { kind: 'workbench', workbench: ordered[0]! }
}

export function GuiHostView({
  commandClient,
  pluginPicker,
  settingsSections,
  rendererPluginStatuses,
  workbenches,
  safeMode,
}: GuiHostViewProps): React.JSX.Element {
  const selection = selectGuiHostView(workbenches, rendererPluginStatuses, safeMode)
  const context: GuiWorkbenchContext = {
    commandClient,
    pluginPicker,
    settingsSections,
    rendererPluginStatuses,
  }

  if (selection.kind === 'shell') {
    return <PictorShell {...context} safeMode={safeMode} state={selection.state} />
  }

  const workbench = selection.workbench
  return (
    <WorkbenchErrorBoundary
      renderFallback={(error) => (
        <PictorShell
          {...context}
          safeMode={safeMode}
          state={{
            kind: 'workbench-render-failure',
            workbench: toWorkbenchReference(workbench),
            reason: sanitizeGuiDiagnostic(error, 'Workbench 渲染失败'),
          }}
        />
      )}
    >
      <WorkbenchSlot contribution={workbench} context={context} />
    </WorkbenchErrorBoundary>
  )
}

function WorkbenchSlot({
  contribution,
  context,
}: {
  contribution: GuiWorkbenchContribution
  context: GuiWorkbenchContext
}): React.JSX.Element {
  return <>{contribution.render(context)}</>
}

class WorkbenchErrorBoundary extends Component<
  { children: ReactNode; renderFallback: (error: unknown) => ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // The fallback is intentionally owned by the GUI Host. A Workbench error
    // must not escape into the Renderer-level fatal state.
  }

  render(): ReactNode {
    return this.state.error === null
      ? this.props.children
      : this.props.renderFallback(this.state.error)
  }
}

function compareWorkbench(left: GuiWorkbenchContribution, right: GuiWorkbenchContribution): number {
  return compareText(left.id, right.id) || compareText(left.pluginId, right.pluginId)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function toWorkbenchReference(workbench: GuiWorkbenchContribution): GuiWorkbenchReference {
  return { id: workbench.id, pluginId: workbench.pluginId }
}
