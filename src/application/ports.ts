import type {
  Project,
  SessionHistoryState,
  SessionHistoryView,
  SessionRecord,
  SessionSummary,
} from '../shared/domain.js'
import type { ModelSettings } from '../shared/model.js'
import type { RuntimePluginBootstrap } from '../shared/plugins.js'
import type {
  RuntimeCompactConfig,
  RuntimeCompactResult,
  RuntimeEvent,
  RuntimeExportConfig,
  RuntimeExportResult,
  RuntimeForkConfig,
  RuntimeForkResult,
  RuntimeImportConfig,
  RuntimeImportResult,
  RuntimeLabelConfig,
  RuntimeLabelResult,
  RuntimeNavigateConfig,
  RuntimeNavigateResult,
  RuntimeSessionOpenConfig,
  RuntimeStartConfig,
} from '../shared/runtime-protocol.js'

export interface UserData {
  readonly userDataDirectory: string
  readonly dataDirectory: string
}

export interface EventPublisher {
  publish(event: RuntimeEvent): void
}

export interface FrontendLockLease {
  release(): void | Promise<void>
}

export interface FrontendLock {
  acquire(): Promise<FrontendLockLease | null>
}

export interface RuntimePersistence {
  selectContext?(projectId: string | null, sessionId: string | null): Promise<void>
  getSelectedContext(): { projectId: string | null; sessionId: string | null }
  removeProject(projectId: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  getSession(sessionId: string): Promise<SessionRecord>
  getSessionHistory(sessionId: string): SessionHistoryState
  inspectSessionHistory(
    sessionId: string,
    selectedEntryId: string | null,
  ): Promise<SessionHistoryView>
  bindPiSession(sessionId: string, identity: { id: string; path: string }): Promise<void>
  rebuildSessionProjection(sessionId: string): Promise<SessionRecord>
  setPiSessionActiveLeaf(sessionId: string, activeLeafId: string | null): Promise<void>
  setSessionRuntimePreferences?(
    sessionId: string,
    runtimePreferences: NonNullable<SessionHistoryState['runtimePreferences']>,
  ): Promise<void>
  createDerivedSession(
    sourceSessionId: string,
    targetSessionId: string,
    kind: 'fork' | 'clone',
    identity: { id: string; path: string },
  ): Promise<SessionSummary>
  createImportedSession(
    projectId: string,
    targetSessionId: string,
    title: string,
    identity: { id: string; path: string },
  ): Promise<SessionSummary>
  commitSessionReplacement?(
    operationId: string,
    sourceSessionId: string,
    targetSessionId: string,
    kind: 'new' | 'fork' | 'switch',
    identity: { id: string; path: string },
    targetProjectId?: string,
    cwd?: string,
  ): Promise<SessionSummary>
  prepareSessionReplacement?(entry: {
    operationId: string
    sourceSessionId: string
    targetSessionId: string
    kind: 'new' | 'fork' | 'switch'
    targetProjectId?: string
    targetSessionPath: string | null
    sourcePiSessionPath: string | null
  }): Promise<void>
  abortSessionReplacement?(operationId: string): Promise<void>
  findSessionByPiSessionPath?(piSessionPath: string): Promise<SessionSummary | null>
  getProject(projectId: string): Project
  findProjectByPath?(rootPath: string): Promise<Project | null>
  ensureProjectByPath?(rootPath: string): Promise<Project>
  getSettings(): Promise<ModelSettings | null>
  getApiKey(): Promise<string | null>
  getRuntimePaths(
    projectId: string,
    sessionId: string,
  ): {
    agentDirectory: string
    sessionDirectory: string
    resumeSession: boolean
    piSessionPath?: string | null
    activeLeafId?: string | null
    runtimePreferences?: SessionHistoryState['runtimePreferences']
  }
  saveSession(session: SessionRecord): Promise<unknown>
}

export interface RuntimeHost {
  configurePluginBootstrap?(bootstrap: RuntimePluginBootstrap): void
  openSession?(config: RuntimeSessionOpenConfig): Promise<void>
  closeSession?(): Promise<void>
  start(config: RuntimeStartConfig): Promise<void>
  fork(config: RuntimeForkConfig): Promise<RuntimeForkResult>
  importSession(config: RuntimeImportConfig): Promise<RuntimeImportResult>
  exportSession(config: RuntimeExportConfig): Promise<RuntimeExportResult>
  navigateSession(config: RuntimeNavigateConfig): Promise<RuntimeNavigateResult>
  compactSession(config: RuntimeCompactConfig): Promise<RuntimeCompactResult>
  labelSessionEntry(config: RuntimeLabelConfig): Promise<RuntimeLabelResult>
  abortSessionOperation(operationId: string): void
  reloadResources(sessionId: string): Promise<void>
  getRuntimeControls?(sessionId: string): Promise<{
    modelId: string | null
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    activeTools: string[]
    availableTools: string[]
    steeringMode: 'all' | 'one-at-a-time'
    followUpMode: 'all' | 'one-at-a-time'
  } | null>
  setRuntimeControls?(
    sessionId: string,
    controls: {
      modelId: string | null
      thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
      activeTools: string[]
      steeringMode: 'all' | 'one-at-a-time'
      followUpMode: 'all' | 'one-at-a-time'
    },
  ): Promise<void>
  stop(runId: string): void
  respondToExtensionUi(sessionId: string, requestId: string, value: string | boolean | null): void
  updateComposerText?(sessionId: string, text: string): void
  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): void
  clearQueue(runId: string): void
  isActive(): boolean
  dispose?(): Promise<void>
}
