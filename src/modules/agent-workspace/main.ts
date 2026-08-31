import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { dialog } from 'electron'

import { moduleHandlerContributions, registerModuleHandlers } from '../../kernel/contract.js'
import { defineModule } from '../../kernel/module.js'
import type { ModelConnectionTester } from '../../main/model-connection.js'
import type { AppRepository } from '../../main/persistence/app-repository.js'
import type { RuntimeCoordinator } from '../../main/runtime/coordinator.js'
import { PictorError } from '../../shared/errors.js'
import { ipcResult } from '../../shared/ipc-result.js'
import { agentWorkspaceContract, sessionRuntimeControlsSchema } from './shared.js'

const imageMimeTypes: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

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

export interface AgentWorkspaceMainHost {
  repository: AgentWorkspaceRepository
  runtime: AgentWorkspaceRuntime
  connectionTester: Pick<ModelConnectionTester, 'test' | 'listModels'>
}

function exportFileName(title: string, extension: string): string {
  const printableTitle = [...title]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
  const safeTitle = printableTitle
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[ .]+$/g, '')
    .trim()
  return `${safeTitle || 'session'}.${extension}`
}

export function createAgentWorkspaceMainModule(host: AgentWorkspaceMainHost) {
  const { repository, runtime, connectionTester } = host
  return defineModule({
    id: 'pictor.agent-workspace.main',
    activate(context) {
      context.contribute(
        moduleHandlerContributions,
        registerModuleHandlers(agentWorkspaceContract, {
          getSnapshot: async () => ipcResult(() => repository.getSnapshot()),
          pickProjectDirectory: async () =>
            ipcResult(async () => {
              const selection = await dialog.showOpenDialog({
                title: '选择 Pictor 项目目录',
                properties: ['openDirectory', 'createDirectory'],
              })
              const rootPath = selection.filePaths[0]
              if (selection.canceled || !rootPath) return null
              const existing = await repository.findProjectByPath(rootPath)
              return {
                name: basename(rootPath),
                rootPath,
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
            ipcResult(async () => {
              const selection = await dialog.showOpenDialog({
                title: '导入 Pi Session JSONL',
                properties: ['openFile'],
                filters: [{ name: 'Pi Session', extensions: ['jsonl'] }],
              })
              const path = selection.filePaths[0]
              if (selection.canceled || !path) return null
              return runtime.importSession(request.projectId, path)
            }),
          exportSession: async (request) =>
            ipcResult(async () => {
              const session = await repository.getSession(request.sessionId)
              const extension = request.format
              const selection = await dialog.showSaveDialog({
                title:
                  request.format === 'jsonl' ? '导出 Pi Session JSONL' : '导出 Pi Session HTML',
                defaultPath: exportFileName(session.title, extension),
                filters: [
                  request.format === 'jsonl'
                    ? { name: 'Pi Session', extensions: ['jsonl'] }
                    : { name: 'HTML', extensions: ['html'] },
                ],
              })
              if (selection.canceled || !selection.filePath) return false
              const destinationPath = extname(selection.filePath)
                ? selection.filePath
                : `${selection.filePath}.${extension}`
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
          pickMessageImages: async () =>
            ipcResult(async () => {
              const selection = await dialog.showOpenDialog({
                title: '选择图片',
                properties: ['openFile', 'multiSelections'],
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
              })
              if (selection.canceled) return []
              return Promise.all(
                selection.filePaths.map(async (path) => {
                  const mimeType = imageMimeTypes[extname(path).toLowerCase()]
                  if (!mimeType) {
                    throw new PictorError('invalid-input', '请选择支持的图片格式')
                  }
                  return {
                    data: (await readFile(path)).toString('base64'),
                    mimeType,
                    name: basename(path),
                  }
                }),
              )
            }),
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
