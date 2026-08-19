import { ContributionPoint } from '../kernel/module.js'
import type { RuntimeStartConfig } from '../shared/runtime-protocol.js'

export interface AgentRuntimeResources {
  extensionPaths: readonly string[]
}

export interface AgentRuntimeProvider {
  id: string
  configure(resources: AgentRuntimeResources): void
  start(config: RuntimeStartConfig): Promise<void>
  resolveApproval(runId: string, callId: string, allowed: boolean): void
  abort(runId: string): Promise<void>
  respondToExtensionUi(requestId: string, value: string | boolean | null): void
  dispose(): Promise<void>
}

export const agentRuntimeContributions = new ContributionPoint<AgentRuntimeProvider>(
  'agent.runtimes',
)

export const piExtensionPathContributions = new ContributionPoint<string>('pi.extension-paths')
