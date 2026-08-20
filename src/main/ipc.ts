import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'

import { dialog, ipcMain, type WebFrameMain } from 'electron'

import {
  approvalResolutionRequestSchema,
  cloneSessionRequestSchema,
  compactSessionRequestSchema,
  createSessionRequestSchema,
  extensionUiResponseRequestSchema,
  exportSessionRequestSchema,
  forkSessionRequestSchema,
  importSessionRequestSchema,
  inspectSessionHistoryRequestSchema,
  listModelsRequestSchema,
  navigateSessionTreeRequestSchema,
  projectIdRequestSchema,
  queueRuntimeMessageRequestSchema,
  pluginIdRequestSchema,
  registerProjectRequestSchema,
  relinkProjectRequestSchema,
  renameSessionRequestSchema,
  removePluginRequestSchema,
  saveSettingsRequestSchema,
  saveSessionRuntimeControlsRequestSchema,
  sessionRuntimeControlsSchema,
  selectContextRequestSchema,
  sessionIdRequestSchema,
  startRunRequestSchema,
  setPluginEnabledRequestSchema,
  testSettingsRequestSchema,
  runIdRequestSchema,
} from '../shared/desktop-bridge.js'
import { PictorError } from '../shared/errors.js'
import { ipcResult } from '../shared/ipc-result.js'
import type { ModelConnectionTester } from './model-connection.js'
import type { AppRepository } from './persistence/app-repository.js'
import type { RuntimeCoordinator } from './runtime/coordinator.js'
import type { PluginManager } from './plugins/plugin-manager.js'
import type { AppInfo } from '../shared/app-info.js'
import type { PluginBootstrap } from '../shared/plugins.js'

interface IpcDependencies {
  repository: AppRepository
  connectionTester: ModelConnectionTester
  validateSender: (frame: WebFrameMain | null) => void
  runtimeCoordinator: RuntimeCoordinator
  appInfo: AppInfo
  getPluginBootstrap: () => Promise<PluginBootstrap>
  pluginManager: PluginManager
}

const defaultRuntimeTools = [
  'pictor_list',
  'pictor_search',
  'pictor_read',
  'pictor_write',
  'pictor_edit',
  'pictor_move',
  'pictor_delete',
  'pictor_command',
] as const

const imageMimeTypes: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
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

export function registerIpc(dependencies: IpcDependencies): void {
  const {
    repository,
    connectionTester,
    validateSender,
    runtimeCoordinator,
    appInfo,
    getPluginBootstrap,
    pluginManager,
  } = dependencies

  ipcMain.handle('app:get-snapshot', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(() => repository.getSnapshot())
  })

  ipcMain.handle('app:get-info', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => appInfo)
  })

  ipcMain.handle('plugin:get-bootstrap', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(getPluginBootstrap)
  })

  ipcMain.handle('plugin:get-manager-snapshot', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(() => pluginManager.getSnapshot())
  })

  ipcMain.handle('plugin:install-local', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择 Pictor Plugin 目录',
        properties: ['openDirectory'],
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) return pluginManager.getSnapshot()
      return pluginManager.installLocal(path)
    })
  })

  ipcMain.handle('plugin:install-pi-extension', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择 Pi Extension 文件或目录',
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Pi Extension', extensions: ['ts', 'js'] }],
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) return pluginManager.getSnapshot()
      return pluginManager.installPiExtension(path)
    })
  })

  ipcMain.handle('plugin:install-pi-package', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择 Pi Package 目录',
        properties: ['openDirectory'],
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) return pluginManager.getSnapshot()
      return pluginManager.installPiPackage(path)
    })
  })

  ipcMain.handle('plugin:set-enabled', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = setPluginEnabledRequestSchema.parse(input)
      return pluginManager.setEnabled(request.kind, request.id, request.enabled)
    })
  })

  ipcMain.handle('plugin:remove', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = removePluginRequestSchema.parse(input)
      return pluginManager.remove(request.kind, request.id, request.deleteData)
    })
  })

  ipcMain.handle('plugin:restore-bundled', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = pluginIdRequestSchema.parse(input)
      return pluginManager.restoreBundled(request.id)
    })
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

  ipcMain.handle('message:pick-images', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择图片',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      })
      if (selection.canceled) return []
      return Promise.all(
        selection.filePaths.map(async (path) => {
          const mimeType = imageMimeTypes[extname(path).toLowerCase()]
          if (!mimeType) throw new PictorError('invalid-input', '请选择支持的图片格式')
          return {
            data: (await readFile(path)).toString('base64'),
            mimeType,
            name: basename(path),
          }
        }),
      )
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

  ipcMain.handle('session:inspect-history', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = inspectSessionHistoryRequestSchema.parse(input)
      return repository.inspectSessionHistory(request.sessionId, request.entryId)
    })
  })

  ipcMain.handle('session:navigate-tree', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = navigateSessionTreeRequestSchema.parse(input)
      return runtimeCoordinator.navigateSessionTree(request.sessionId, request.entryId, {
        summarize: request.summarize,
        customInstructions: request.customInstructions,
      })
    })
  })

  ipcMain.handle('session:compact', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = compactSessionRequestSchema.parse(input)
      return runtimeCoordinator.compactSession(request.sessionId, request.customInstructions)
    })
  })

  ipcMain.handle('session:cancel-operation', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = sessionIdRequestSchema.parse(input)
      return runtimeCoordinator.cancelSessionOperation(request.sessionId)
    })
  })

  ipcMain.handle('session:get-runtime-controls', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = sessionIdRequestSchema.parse(input)
      const history = repository.getSessionHistory(request.sessionId)
      const settings = await repository.getSettings()
      if (!settings) throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
      const preferences = history.runtimePreferences
      return sessionRuntimeControlsSchema.parse({
        modelId: settings.modelId,
        thinkingLevel: preferences?.thinkingLevel ?? settings.reasoningEffort ?? 'off',
        activeTools: preferences?.activeTools ?? defaultRuntimeTools,
        availableTools: defaultRuntimeTools,
        steeringMode: preferences?.steeringMode ?? 'one-at-a-time',
        followUpMode: preferences?.followUpMode ?? 'one-at-a-time',
      })
    })
  })

  ipcMain.handle('session:save-runtime-controls', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = saveSessionRuntimeControlsRequestSchema.parse(input)
      await repository.setSessionRuntimePreferences(request.sessionId, request.controls)
      const settings = await repository.getSettings()
      if (!settings) throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
      return sessionRuntimeControlsSchema.parse({
        modelId: settings.modelId,
        ...request.controls,
        availableTools: defaultRuntimeTools,
      })
    })
  })

  ipcMain.handle('session:reload-resources', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = sessionIdRequestSchema.parse(input)
      await runtimeCoordinator.reloadSessionResources(request.sessionId)
      return null
    })
  })

  ipcMain.handle('session:fork', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = forkSessionRequestSchema.parse(input)
      return runtimeCoordinator.forkSession(request.sessionId, request.entryId)
    })
  })

  ipcMain.handle('session:clone', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = cloneSessionRequestSchema.parse(input)
      return runtimeCoordinator.cloneSession(request.sessionId)
    })
  })

  ipcMain.handle('session:import', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = importSessionRequestSchema.parse(input)
      const selection = await dialog.showOpenDialog({
        title: '导入 Pi Session JSONL',
        properties: ['openFile'],
        filters: [{ name: 'Pi Session', extensions: ['jsonl'] }],
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) return null
      return runtimeCoordinator.importSession(request.projectId, path)
    })
  })

  ipcMain.handle('session:export', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = exportSessionRequestSchema.parse(input)
      const session = await repository.getSession(request.sessionId)
      const extension = request.format
      const selection = await dialog.showSaveDialog({
        title: request.format === 'jsonl' ? '导出 Pi Session JSONL' : '导出 Pi Session HTML',
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
      await runtimeCoordinator.exportSession(request.sessionId, request.format, destinationPath)
      return true
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
      return runtimeCoordinator.start(request.sessionId, request.prompt, request.images ?? [])
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

  ipcMain.handle('runtime:extension-ui-response', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = extensionUiResponseRequestSchema.parse(input)
      runtimeCoordinator.respondToExtensionUi(request.runId, request.requestId, request.value)
      return null
    })
  })

  ipcMain.handle('runtime:queue-message', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = queueRuntimeMessageRequestSchema.parse(input)
      runtimeCoordinator.queueMessage(request.runId, request.mode, request.message)
      return null
    })
  })

  ipcMain.handle('runtime:clear-queue', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = runIdRequestSchema.parse(input)
      runtimeCoordinator.clearQueue(request.runId)
      return null
    })
  })
}
