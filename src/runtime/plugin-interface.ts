import { ContributionPoint } from '../kernel/module.js'
import type { RuntimeStartConfig } from '../shared/runtime-protocol.js'

export interface AgentRuntimeProvider {
  id: string
  start(config: RuntimeStartConfig): Promise<void>
  resolveApproval(runId: string, callId: string, allowed: boolean): void
  abort(runId: string): Promise<void>
  dispose(): Promise<void>
}

export const agentRuntimeContributions = new ContributionPoint<AgentRuntimeProvider>(
  'agent.runtimes',
)
