import { contextBridge, ipcRenderer } from 'electron'

import {
  guiPluginPickerRequestSchema,
  guiPluginPickerResultSchema,
  sessionExportPickerRequestSchema,
  workspaceFilePathResultSchema,
  workspaceImagePickerResultSchema,
  type PlatformFilePicker,
} from '../shared/desktop-bridge.js'

const platformFilePicker = Object.freeze({
  pickPlugin: async (source) =>
    guiPluginPickerResultSchema.parse(
      await ipcRenderer.invoke('plugin:pick', guiPluginPickerRequestSchema.parse({ source })),
    ),
  pickProjectDirectory: async () =>
    workspaceFilePathResultSchema.parse(
      await ipcRenderer.invoke('workspace:pick-project-directory'),
    ),
  pickSessionImport: async () =>
    workspaceFilePathResultSchema.parse(await ipcRenderer.invoke('workspace:pick-session-import')),
  pickSessionExport: async (input) =>
    workspaceFilePathResultSchema.parse(
      await ipcRenderer.invoke(
        'workspace:pick-session-export',
        sessionExportPickerRequestSchema.parse(input),
      ),
    ),
  pickMessageImages: async () =>
    workspaceImagePickerResultSchema.parse(
      await ipcRenderer.invoke('workspace:pick-message-images'),
    ),
} satisfies PlatformFilePicker)

contextBridge.exposeInMainWorld('pictorDesktop', platformFilePicker)
