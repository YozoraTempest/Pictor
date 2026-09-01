import { contextBridge, ipcRenderer } from 'electron'

import {
  moduleEventEnvelopeSchema,
  moduleInvocationSchema,
  type ModuleTransport,
} from '../kernel/contract.js'
import {
  appInfoResultSchema,
  packageSpecRequestSchema,
  pluginBootstrapResultSchema,
  pluginIdRequestSchema,
  pluginManagerResultSchema,
  removePluginRequestSchema,
  sessionExportPickerRequestSchema,
  setPluginEnabledRequestSchema,
  voidResultSchema,
  workspaceFilePathResultSchema,
  workspaceImagePickerResultSchema,
  type PictorBridge,
} from '../shared/desktop-bridge.js'

const bridge = Object.freeze({
  notifyRendererReady: async () =>
    voidResultSchema.parse(await ipcRenderer.invoke('app:renderer-ready')),
  getAppInfo: async () => appInfoResultSchema.parse(await ipcRenderer.invoke('app:get-info')),
  getPluginBootstrap: async () =>
    pluginBootstrapResultSchema.parse(await ipcRenderer.invoke('plugin:get-bootstrap')),
  getPluginManagerSnapshot: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:get-manager-snapshot')),
  installLocalPlugin: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-local')),
  installPiExtension: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-pi-extension')),
  installPiPackage: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-pi-package')),
  installDevelopmentPlugin: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-development')),
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
  installPiPackageSpec: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke(
        'plugin:install-pi-package-spec',
        packageSpecRequestSchema.parse(input),
      ),
    ),
  setPluginEnabled: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke('plugin:set-enabled', setPluginEnabledRequestSchema.parse(input)),
    ),
  removePlugin: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke('plugin:remove', removePluginRequestSchema.parse(input)),
    ),
  restoreBundledPlugin: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke('plugin:restore-bundled', pluginIdRequestSchema.parse(input)),
    ),
} satisfies PictorBridge)

const moduleTransport = Object.freeze({
  invoke: async (moduleId, method, input) =>
    ipcRenderer.invoke('module:invoke', moduleInvocationSchema.parse({ moduleId, method, input })),
  onEvent: (moduleId, eventName, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const event = moduleEventEnvelopeSchema.parse(input)
      if (event.moduleId === moduleId && event.event === eventName) listener(event.payload)
    }
    ipcRenderer.on('module:event', handler)
    return () => ipcRenderer.removeListener('module:event', handler)
  },
} satisfies ModuleTransport)

contextBridge.exposeInMainWorld('pictor', bridge)
contextBridge.exposeInMainWorld('pictorModules', moduleTransport)
