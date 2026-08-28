import { ContributionPoint } from '../kernel/module.js'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ModelSettingsInput } from '../shared/model.js'
import type {
  RuntimeCompactConfig,
  RuntimeExportConfig,
  RuntimeForkConfig,
  RuntimeImportConfig,
  RuntimeLabelConfig,
  RuntimeNavigateConfig,
  RuntimeSessionOpenConfig,
  RuntimeStartConfig,
  RuntimeSessionReplacementRequest,
  RuntimeControlsSnapshot,
} from '../shared/runtime-protocol.js'

export type AgentRuntimeForkResult =
  { outcome: 'completed'; piSessionId: string; piSessionPath: string } | { outcome: 'cancelled' }

export type AgentRuntimeImportResult = AgentRuntimeForkResult

export type AgentRuntimeExportResult = { outcome: 'completed' }

export type AgentRuntimeNavigateResult =
  | {
      outcome: 'completed'
      activeLeafId: string | null
      editorText: string | null
      summaryCreated: boolean
    }
  | { outcome: 'cancelled' }

export type AgentRuntimeCompactResult =
  | {
      outcome: 'completed'
      activeLeafId: string
      tokensBefore: number
      estimatedTokensAfter: number | null
    }
  | { outcome: 'cancelled' }

export type AgentRuntimeLabelResult = { outcome: 'completed'; activeLeafId: string }

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
  requestSessionReplacement?: (
    request: RuntimeSessionReplacementRequest,
  ) => Promise<{ accepted: boolean; targetSessionId?: string; message?: string }>
}

export interface AgentRuntimeProvider {
  id: string
  configure(resources: AgentRuntimeResources): void
  openSession(config: RuntimeSessionOpenConfig): Promise<void>
  closeSession(): Promise<void>
  start(config: RuntimeStartConfig): Promise<void>
  fork(config: RuntimeForkConfig): Promise<AgentRuntimeForkResult>
  importSession(config: RuntimeImportConfig): Promise<AgentRuntimeImportResult>
  exportSession(config: RuntimeExportConfig): Promise<AgentRuntimeExportResult>
  navigateSession(config: RuntimeNavigateConfig): Promise<AgentRuntimeNavigateResult>
  compactSession(config: RuntimeCompactConfig): Promise<AgentRuntimeCompactResult>
  labelSessionEntry(config: RuntimeLabelConfig): Promise<AgentRuntimeLabelResult>
  reloadResources(sessionId: string): Promise<void>
  getRuntimeControls(sessionId: string): RuntimeControlsSnapshot | null
  setRuntimeControls(
    sessionId: string,
    controls: Omit<RuntimeControlsSnapshot, 'type' | 'sessionId' | 'availableTools'>,
  ): Promise<void>
  abortSessionOperation(operationId: string): void
  abort(runId: string): Promise<void>
  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): Promise<void>
  clearQueue(runId: string): void
  respondToExtensionUi(requestId: string, value: string | boolean | null): void
  updateComposerText(sessionId: string, text: string): void
  dispose(): Promise<void>
}

export const agentRuntimeContributions = new ContributionPoint<AgentRuntimeProvider>(
  'agent.runtimes',
)

export const piExtensionPathContributions = new ContributionPoint<string>('pi.extension-paths')

export const modelRuntimeProviderContributions = new ContributionPoint<ModelRuntimeProvider>(
  'model.providers',
)
