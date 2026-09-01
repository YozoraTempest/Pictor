import { extname } from 'node:path'

import { dialog, ipcMain, type WebFrameMain } from 'electron'

import { executeCommandAndWait } from '../commands/await.js'
import type { CommandClient } from '../commands/index.js'
import { readMessageImages } from '../modules/agent-workspace/file-operations.js'
import {
  packageSpecRequestSchema,
  pluginIdRequestSchema,
  removePluginRequestSchema,
  sessionExportPickerRequestSchema,
  setPluginEnabledRequestSchema,
} from '../shared/desktop-bridge.js'
import type { AppInfo } from '../shared/app-info.js'
import { ipcResult } from '../shared/ipc-result.js'
import {
  pluginManagerSnapshotSchema,
  type PluginBootstrap,
  type PluginManagerSnapshot,
} from '../shared/plugins.js'
import type { PluginManager } from './plugins/plugin-manager.js'
import type { Disposable } from '../kernel/module.js'

const IPC_CHANNELS = [
  'app:renderer-ready',
  'app:get-info',
  'plugin:get-bootstrap',
  'plugin:get-manager-snapshot',
  'plugin:install-local',
  'plugin:install-development',
  'plugin:install-pi-extension',
  'plugin:install-pi-package',
  'plugin:install-pi-package-spec',
  'plugin:set-enabled',
  'plugin:remove',
  'plugin:restore-bundled',
  'workspace:pick-project-directory',
  'workspace:pick-session-import',
  'workspace:pick-session-export',
  'workspace:pick-message-images',
] as const

interface IpcDependencies {
  validateSender: (frame: WebFrameMain | null) => void
  onRendererReady: () => Promise<void>
  appInfo: AppInfo
  getPluginBootstrap: () => Promise<PluginBootstrap>
  pluginManager: PluginManager
  commandClient?: CommandClient
}

export function registerIpc(dependencies: IpcDependencies): Disposable {
  const { validateSender, onRendererReady, appInfo, getPluginBootstrap, pluginManager } =
    dependencies
  const commandClient = dependencies.commandClient

  const runPluginCommand = (commandId: string, input: unknown): Promise<PluginManagerSnapshot> => {
    if (!commandClient) throw new Error('Command Engine is unavailable')
    return executeCommandAndWait(
      commandClient,
      commandId,
      input,
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
  }

  ipcMain.handle('app:renderer-ready', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      await onRendererReady()
      return null
    })
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
    return ipcResult(() =>
      commandClient ? runPluginCommand('plugin.list', null) : pluginManager.getSnapshot(),
    )
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
      return commandClient
        ? runPluginCommand('plugin.install', { source: 'local', path })
        : pluginManager.installLocal(path)
    })
  })

  ipcMain.handle('plugin:install-development', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择 Local Development Plugin 目录',
        properties: ['openDirectory'],
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) return pluginManager.getSnapshot()
      return commandClient
        ? runPluginCommand('plugin.install', { source: 'development', path })
        : pluginManager.installDevelopment(path)
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
      return commandClient
        ? runPluginCommand('plugin.install', { source: 'pi-extension', path })
        : pluginManager.installPiExtension(path)
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
      return commandClient
        ? runPluginCommand('plugin.install', { source: 'pi-package', path })
        : pluginManager.installPiPackage(path)
    })
  })

  ipcMain.handle('plugin:install-pi-package-spec', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = packageSpecRequestSchema.parse(input)
      return commandClient
        ? runPluginCommand('plugin.install', {
            source: 'pi-package-spec',
            spec: request.spec,
          })
        : pluginManager.installPiPackageSpec(request.spec)
    })
  })

  ipcMain.handle('plugin:set-enabled', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = setPluginEnabledRequestSchema.parse(input)
      return commandClient
        ? runPluginCommand(request.enabled ? 'plugin.enable' : 'plugin.disable', {
            kind: request.kind,
            id: request.id,
          })
        : pluginManager.setEnabled(request.kind, request.id, request.enabled)
    })
  })

  ipcMain.handle('plugin:remove', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = removePluginRequestSchema.parse(input)
      return commandClient
        ? runPluginCommand('plugin.remove', request)
        : pluginManager.remove(request.kind, request.id, request.deleteData)
    })
  })

  ipcMain.handle('plugin:restore-bundled', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = pluginIdRequestSchema.parse(input)
      return commandClient
        ? runPluginCommand('plugin.restore', request)
        : pluginManager.restoreBundled(request.id)
    })
  })

  ipcMain.handle('workspace:pick-project-directory', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择 Pictor 项目目录',
        properties: ['openDirectory', 'createDirectory'],
      })
      const path = selection.filePaths[0]
      return selection.canceled || !path ? null : path
    })
  })

  ipcMain.handle('workspace:pick-session-import', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '导入 Pi Session JSONL',
        properties: ['openFile'],
        filters: [{ name: 'Pi Session', extensions: ['jsonl'] }],
      })
      const path = selection.filePaths[0]
      return selection.canceled || !path ? null : path
    })
  })

  ipcMain.handle('workspace:pick-session-export', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = sessionExportPickerRequestSchema.parse(input)
      const selection = await dialog.showSaveDialog({
        title: request.format === 'jsonl' ? '导出 Pi Session JSONL' : '导出 Pi Session HTML',
        defaultPath: request.defaultFileName,
        filters: [
          request.format === 'jsonl'
            ? { name: 'Pi Session', extensions: ['jsonl'] }
            : { name: 'HTML', extensions: ['html'] },
        ],
      })
      if (selection.canceled || !selection.filePath) return null
      const extension = request.format
      return extname(selection.filePath) ? selection.filePath : `${selection.filePath}.${extension}`
    })
  })

  ipcMain.handle('workspace:pick-message-images', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择图片',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      })
      if (selection.canceled) return null
      return readMessageImages(selection.filePaths)
    })
  })

  return {
    dispose: () => {
      for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
    },
  }
}
