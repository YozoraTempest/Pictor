import { dialog, ipcMain, type WebFrameMain } from 'electron'

import {
  packageSpecRequestSchema,
  pluginIdRequestSchema,
  removePluginRequestSchema,
  setPluginEnabledRequestSchema,
} from '../shared/desktop-bridge.js'
import type { AppInfo } from '../shared/app-info.js'
import { ipcResult } from '../shared/ipc-result.js'
import type { PluginBootstrap } from '../shared/plugins.js'
import type { PluginManager } from './plugins/plugin-manager.js'

interface IpcDependencies {
  validateSender: (frame: WebFrameMain | null) => void
  onRendererReady: () => Promise<void>
  appInfo: AppInfo
  getPluginBootstrap: () => Promise<PluginBootstrap>
  pluginManager: PluginManager
}

export function registerIpc(dependencies: IpcDependencies): void {
  const { validateSender, onRendererReady, appInfo, getPluginBootstrap, pluginManager } =
    dependencies

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

  ipcMain.handle('plugin:install-development', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择 Local Development Plugin 目录',
        properties: ['openDirectory'],
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) return pluginManager.getSnapshot()
      return pluginManager.installDevelopment(path)
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

  ipcMain.handle('plugin:install-pi-package-spec', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = packageSpecRequestSchema.parse(input)
      return pluginManager.installPiPackageSpec(request.spec)
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
}
