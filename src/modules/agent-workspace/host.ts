import { basename, extname, isAbsolute } from 'node:path'

import { moduleHandlerContributions, registerModuleHandlers } from '../../kernel/contract.js'
import { defineModule } from '../../kernel/module.js'
import type { ModelConnectionTester } from '../../main/model-connection.js'
import type { AppRepository } from '../../main/persistence/app-repository.js'
import type { RuntimeCoordinator } from '../../main/runtime/coordinator.js'
import { PictorError } from '../../shared/errors.js'
import { ipcResult } from '../../shared/ipc-result.js'
import { agentWorkspaceContract, sessionRuntimeControlsSchema } from './shared.js'

type AgentWorkspaceRepository = Pick<
  AppRepository,
  | 'getSnapshot'
  | 'findProjectByPath'
  | 'registerProject'
  | 'relinkProject'
  | 'createSession'
  | 'getSession'
  | 'inspectSessionHistory'
  | 'renameSession'
  | 'getSettings'
  | 'saveSettings'
  | 'getApiKey'
>

type AgentWorkspaceRuntime = Pick<
  RuntimeCoordinator,
  | 'removeProject'
  | 'selectContext'
  | 'navigateSessionTree'
  | 'compactSession'
  | 'labelSessionEntry'
  | 'cancelSessionOperation'
  | 'getSessionRuntimeControls'
  | 'setSessionRuntimeControls'
  | 'reloadSessionResources'
  | 'forkSession'
  | 'cloneSession'
  | 'importSession'
  | 'exportSession'
  | 'deleteSession'
  | 'start'
  | 'stop'
  | 'respondToExtensionUi'
  | 'updateComposerText'
  | 'queueMessage'
  | 'clearQueue'
>

export interface AgentWorkspaceHost {
  repository: AgentWorkspaceRepository
  runtime: AgentWorkspaceRuntime
  connectionTester: Pick<ModelConnectionTester, 'test' | 'listModels'>
}

function requireAbsolutePath(path: string, extension: '.jsonl' | '.html', message: string): string {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== extension) {
    throw new PictorError('invalid-input', message)
  }
  return path
}

export function createAgentWorkspaceHostModule(host: AgentWorkspaceHost) {
  const { repository, runtime, connectionTester } = host
  return defineModule({
    id: 'pictor.agent-workspace.host',
    activate(context) {
      context.contribute(
        moduleHandlerContributions,
        registerModuleHandlers(agentWorkspaceContract, {
          getSnapshot: async () => ipcResult(() => repository.getSnapshot()),
          inspectProjectPath: async (request) =>
            ipcResult(async () => {
              const existing = await repository.findProjectByPath(request.rootPath)
              return {
                name: basename(request.rootPath),
                rootPath: request.rootPath,
                existingProjectId: existing?.id ?? null,
              }
            }),
          registerProject: async (request) =>
            ipcResult(() => repository.registerProject(request.rootPath)),
          relinkProject: async (request) =>
            ipcResult(() => repository.relinkProject(request.projectId, request.rootPath)),
          removeProject: async (request) =>
            ipcResult(async () => {
              await runtime.removeProject(request.projectId)
              return null
            }),
          selectContext: async (request) =>
            ipcResult(async () => {
              await runtime.selectContext(request.projectId, request.sessionId)
              return null
            }),
          createSession: async (request) =>
            ipcResult(() => repository.createSession(request.projectId)),
          renameSession: async (request) =>
            ipcResult(() => repository.renameSession(request.sessionId, request.title)),
          deleteSession: async (request) =>
            ipcResult(async () => {
              await runtime.deleteSession(request.sessionId)
              return null
            }),
          getSession: async (request) => ipcResult(() => repository.getSession(request.sessionId)),
          inspectSessionHistory: async (request) =>
            ipcResult(() => repository.inspectSessionHistory(request.sessionId, request.entryId)),
          navigateSessionTree: async (request) =>
            ipcResult(() =>
              runtime.navigateSessionTree(request.sessionId, request.entryId, {
                summarize: request.summarize,
                customInstructions: request.customInstructions,
              }),
            ),
          compactSession: async (request) =>
            ipcResult(() => runtime.compactSession(request.sessionId, request.customInstructions)),
          labelSessionEntry: async (request) =>
            ipcResult(() =>
              runtime.labelSessionEntry(request.sessionId, request.entryId, request.label),
            ),
          cancelSessionOperation: async (request) =>
            ipcResult(async () => runtime.cancelSessionOperation(request.sessionId)),
          getSessionRuntimeControls: async (request) =>
            ipcResult(async () =>
              sessionRuntimeControlsSchema.parse({
                ...(await runtime.getSessionRuntimeControls(request.sessionId)),
              }),
            ),
          saveSessionRuntimeControls: async (request) =>
            ipcResult(async () => {
              await runtime.setSessionRuntimeControls(request.sessionId, request.controls)
              return sessionRuntimeControlsSchema.parse({
                ...request.controls,
                availableTools: (await runtime.getSessionRuntimeControls(request.sessionId))
                  .availableTools,
              })
            }),
          reloadSessionResources: async (request) =>
            ipcResult(async () => {
              await runtime.reloadSessionResources(request.sessionId)
              return null
            }),
          forkSession: async (request) =>
            ipcResult(() => runtime.forkSession(request.sessionId, request.entryId)),
          cloneSession: async (request) => ipcResult(() => runtime.cloneSession(request.sessionId)),
          importSession: async (request) =>
            ipcResult(() =>
              runtime.importSession(
                request.projectId,
                requireAbsolutePath(
                  request.sourcePath,
                  '.jsonl',
                  '请选择有效的 Pi Session JSONL 文件',
                ),
              ),
            ),
          exportSession: async (request) =>
            ipcResult(async () => {
              const extension = request.format === 'jsonl' ? '.jsonl' : '.html'
              const destinationPath = requireAbsolutePath(
                request.destinationPath,
                extension,
                `请选择有效的 ${extension} 导出位置`,
              )
              await runtime.exportSession(request.sessionId, request.format, destinationPath)
              return true
            }),
          getSettings: async () => ipcResult(() => repository.getSettings()),
          saveSettings: async (request) => ipcResult(() => repository.saveSettings(request)),
          testSettings: async (request) =>
            ipcResult(async () => {
              const apiKey = request.apiKey ?? (await repository.getApiKey())
              if (!apiKey) {
                throw new PictorError(
                  'invalid-input',
                  '请输入 API Key，或先保存一个可用凭据',
                  'apiKey',
                )
              }
              return connectionTester.test(request, apiKey)
            }),
          listModels: async (request) =>
            ipcResult(async () => {
              const apiKey = request.apiKey ?? (await repository.getApiKey())
              if (!apiKey) {
                throw new PictorError(
                  'invalid-input',
                  '请输入 API Key，或先保存一个可用凭据',
                  'apiKey',
                )
              }
              return connectionTester.listModels(request.baseUrl, apiKey)
            }),
          startRun: async (request) =>
            ipcResult(() => runtime.start(request.sessionId, request.prompt, request.images ?? [])),
          stopRun: async (request) =>
            ipcResult(async () => {
              runtime.stop(request.runId)
              return null
            }),
          respondToExtensionUi: async (request) =>
            ipcResult(async () => {
              runtime.respondToExtensionUi(request.sessionId, request.requestId, request.value)
              return null
            }),
          syncComposerText: async (request) =>
            ipcResult(async () => {
              runtime.updateComposerText(request.sessionId, request.text)
              return null
            }),
          queueRuntimeMessage: async (request) =>
            ipcResult(async () => {
              runtime.queueMessage(request.runId, request.mode, request.message)
              return null
            }),
          clearRuntimeQueue: async (request) =>
            ipcResult(async () => {
              runtime.clearQueue(request.runId)
              return null
            }),
        }),
      )
    },
  })
}
