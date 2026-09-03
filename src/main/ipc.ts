import { extname } from 'node:path'

import { dialog, ipcMain, type WebFrameMain } from 'electron'

import { readMessageImages } from '../modules/agent-workspace/file-operations.js'
import {
  guiPluginPickerRequestSchema,
  sessionExportPickerRequestSchema,
  type GuiPluginSource,
} from '../shared/desktop-bridge.js'
import type { AppInfo } from '../shared/app-info.js'
import { ipcResult } from '../shared/ipc-result.js'
import type { PluginBootstrap } from '../shared/plugins.js'
import type { Disposable } from '../kernel/module.js'

const IPC_CHANNELS = [
  'app:gui-ready',
  'app:get-info',
  'plugin:get-bootstrap',
  'plugin:pick',
  'workspace:pick-project-directory',
  'workspace:pick-session-import',
  'workspace:pick-session-export',
  'workspace:pick-message-images',
] as const

interface IpcDependencies {
  validateSender: (frame: WebFrameMain | null) => void
  onGuiReady: () => Promise<void>
  appInfo: AppInfo
  getPluginBootstrap: () => Promise<PluginBootstrap>
}

export function registerIpc(dependencies: IpcDependencies): Disposable {
  const { validateSender, onGuiReady, appInfo, getPluginBootstrap } = dependencies

  ipcMain.handle('app:gui-ready', (event) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      await onGuiReady()
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

  ipcMain.handle('plugin:pick', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return ipcResult(async () => {
      const request = guiPluginPickerRequestSchema.parse(input)
      const selection = await dialog.showOpenDialog(pluginPickerOptions(request.source))
      const path = selection.filePaths[0]
      return { source: request.source, path: selection.canceled || !path ? null : path }
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

function pluginPickerOptions(source: GuiPluginSource): Electron.OpenDialogOptions {
  switch (source) {
    case 'local':
      return {
        title: '选择 Pictor Plugin 目录',
        properties: ['openDirectory'],
      }
    case 'development':
      return {
        title: '选择 Local Development Plugin 目录',
        properties: ['openDirectory'],
      }
    case 'pi-extension':
      return {
        title: '选择 Pi Extension 文件或目录',
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Pi Extension', extensions: ['ts', 'js'] }],
      }
    case 'pi-package':
      return {
        title: '选择 Pi Package 目录',
        properties: ['openDirectory'],
      }
  }
}
