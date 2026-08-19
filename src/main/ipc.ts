import { basename } from 'node:path'

import { dialog, ipcMain, type WebFrameMain } from 'electron'

import {
  approvalResolutionRequestSchema,
  createSessionRequestSchema,
  listModelsRequestSchema,
  projectIdRequestSchema,
  registerProjectRequestSchema,
  relinkProjectRequestSchema,
  renameSessionRequestSchema,
  saveSettingsRequestSchema,
  selectContextRequestSchema,
  sessionIdRequestSchema,
  startRunRequestSchema,
  testSettingsRequestSchema,
  runIdRequestSchema,
} from '../shared/desktop-bridge.js'
import { PictorError } from '../shared/errors.js'
import { ipcResult } from '../shared/ipc-result.js'
import type { ModelConnectionTester } from './model-connection.js'
import type { AppRepository } from './persistence/app-repository.js'
import type { RuntimeCoordinator } from './runtime/coordinator.js'

interface IpcDependencies {
  repository: AppRepository
  connectionTester: ModelConnectionTester
  validateSender: (frame: WebFrameMain | null) => void
  runtimeCoordinator: RuntimeCoordinator
}

export function registerIpc(dependencies: IpcDependencies): void {
  const { repository, connectionTester, validateSender, runtimeCoordinator } = dependencies

  ipcMain.handle('app:get-snapshot', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(() => repository.getSnapshot())
  })

  ipcMain.handle('project:pick-directory', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
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
    })
  })

  ipcMain.handle('project:register', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = registerProjectRequestSchema.parse(input)
      return repository.registerProject(request.rootPath)
    })
  })

  ipcMain.handle('project:relink', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = relinkProjectRequestSchema.parse(input)
      return repository.relinkProject(request.projectId, request.rootPath)
    })
  })

  ipcMain.handle('project:remove', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = projectIdRequestSchema.parse(input)
      await repository.removeProject(request.projectId)
      return null
    })
  })

  ipcMain.handle('app:select-context', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = selectContextRequestSchema.parse(input)
      await repository.selectContext(request.projectId, request.sessionId)
      return null
    })
  })

  ipcMain.handle('session:create', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = createSessionRequestSchema.parse(input)
      return repository.createSession(request.projectId)
    })
  })

  ipcMain.handle('session:get', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = sessionIdRequestSchema.parse(input)
      return repository.getSession(request.sessionId)
    })
  })

  ipcMain.handle('session:rename', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = renameSessionRequestSchema.parse(input)
      return repository.renameSession(request.sessionId, request.title)
    })
  })

  ipcMain.handle('session:delete', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = sessionIdRequestSchema.parse(input)
      await repository.deleteSession(request.sessionId)
      return null
    })
  })

  ipcMain.handle('settings:get', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(() => repository.getSettings())
  })

  ipcMain.handle('settings:save', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => repository.saveSettings(saveSettingsRequestSchema.parse(input)))
  })

  ipcMain.handle('settings:test', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = testSettingsRequestSchema.parse(input)
      const apiKey = request.apiKey ?? (await repository.getApiKey())
      if (!apiKey) {
        throw new PictorError('invalid-input', '请输入 API Key，或先保存一个可用凭据', 'apiKey')
      }
      return connectionTester.test(request, apiKey)
    })
  })

  ipcMain.handle('settings:list-models', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = listModelsRequestSchema.parse(input)
      const apiKey = request.apiKey ?? (await repository.getApiKey())
      if (!apiKey) {
        throw new PictorError('invalid-input', '请输入 API Key，或先保存一个可用凭据', 'apiKey')
      }
      return connectionTester.listModels(request.baseUrl, apiKey)
    })
  })

  ipcMain.handle('runtime:start', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = startRunRequestSchema.parse(input)
      return runtimeCoordinator.start(request.sessionId, request.prompt)
    })
  })

  ipcMain.handle('runtime:approve', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = approvalResolutionRequestSchema.parse(input)
      runtimeCoordinator.approve(request.runId, request.callId)
      return null
    })
  })

  ipcMain.handle('runtime:reject', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = approvalResolutionRequestSchema.parse(input)
      runtimeCoordinator.reject(request.runId, request.callId)
      return null
    })
  })

  ipcMain.handle('runtime:stop', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = runIdRequestSchema.parse(input)
      runtimeCoordinator.stop(request.runId)
      return null
    })
  })
}
