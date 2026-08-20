import { ContributionPoint } from '../kernel/module.js'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ModelSettingsInput } from '../shared/model.js'
import type { RuntimeStartConfig } from '../shared/runtime-protocol.js'
import type { RuntimeForkConfig } from '../shared/runtime-protocol.js'

export type AgentRuntimeForkResult =
  { outcome: 'completed'; piSessionId: string; piSessionFile: string } | { outcome: 'cancelled' }

export interface ModelRuntimeProvider {
  id: string
  register(
    runtime: ModelRuntime,
    settings: ModelSettingsInput,
    apiKey: string,
  ): NonNullable<ReturnType<ModelRuntime['getModel']>>
}

export interface AgentRuntimeResources {
  extensionPaths: readonly string[]
  skillPaths: readonly string[]
  promptPaths: readonly string[]
  modelProviders: readonly ModelRuntimeProvider[]
}

export interface AgentRuntimeProvider {
  id: string
  configure(resources: AgentRuntimeResources): void
  start(config: RuntimeStartConfig): Promise<void>
  fork(config: RuntimeForkConfig): Promise<AgentRuntimeForkResult>
  resolveApproval(runId: string, callId: string, allowed: boolean): void
  abort(runId: string): Promise<void>
  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): Promise<void>
  clearQueue(runId: string): void
  respondToExtensionUi(requestId: string, value: string | boolean | null): void
  dispose(): Promise<void>
}

export const agentRuntimeContributions = new ContributionPoint<AgentRuntimeProvider>(
  'agent.runtimes',
)

export const piExtensionPathContributions = new ContributionPoint<string>('pi.extension-paths')

export const modelRuntimeProviderContributions = new ContributionPoint<ModelRuntimeProvider>(
  'model.providers',
)
