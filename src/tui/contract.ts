import type { AgentWorkspaceClient } from '../modules/agent-workspace/shared.js'
import type { CommandClient } from '../commands/index.js'
import { ContributionPoint } from '../kernel/module.js'
import type {
  InteractiveRuntimeOptions,
  InteractiveRuntimeRunner,
} from '../runtime/plugin-interface.js'

export interface TuiTerminal {
  readonly columns: number
  readonly rows: number
  start(onInput: (data: string) => void, onResize: () => void): void
  stop(): void
  write(data: string): void
}

export interface TuiInteractiveRuntime {
  createInteractiveRunner(options?: InteractiveRuntimeOptions): InteractiveRuntimeRunner
}

export interface TuiLaunchTarget {
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly nonInteractive: boolean
  readonly tuiMode: 'regular' | 'fullscreen'
}

export interface TuiApplicationContext {
  readonly terminal: TuiTerminal
  readonly workspace: AgentWorkspaceClient
  readonly commandClient: CommandClient
  readonly interactive: TuiInteractiveRuntime
  readonly launchTarget: TuiLaunchTarget
  readonly signal: AbortSignal
}

export interface TuiApplicationContribution {
  readonly owner: string
  readonly id: string
  run(context: TuiApplicationContext): Promise<void>
}

export const tuiApplicationContributions = new ContributionPoint<TuiApplicationContribution>(
  'tui.application-contributions',
)
