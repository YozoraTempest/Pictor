import { contextBridge, ipcRenderer } from 'electron'

import {
  moduleEventEnvelopeSchema,
  moduleInvocationSchema,
  type ModuleTransport,
} from '../kernel/contract.js'
import {
  appInfoResultSchema,
  appSnapshotResultSchema,
  connectionTestIpcResultSchema,
  cloneSessionRequestSchema,
  cloneSessionResultSchema,
  compactSessionRequestSchema,
  composerTextRequestSchema,
  compactSessionResultSchema,
  cancelSessionOperationResultSchema,
  createSessionRequestSchema,
  extensionUiResponseRequestSchema,
  exportSessionRequestSchema,
  exportSessionResultSchema,
  forkSessionRequestSchema,
  forkSessionResultSchema,
  importSessionRequestSchema,
  importSessionResultSchema,
  imageAttachmentsResultSchema,
  inspectSessionHistoryRequestSchema,
  labelSessionEntryRequestSchema,
  listModelsRequestSchema,
  navigateSessionTreeRequestSchema,
  navigateSessionTreeResultSchema,
  modelCatalogIpcResultSchema,
  packageSpecRequestSchema,
  projectCandidateResultSchema,
  projectIdRequestSchema,
  projectResultSchema,
  queueRuntimeMessageRequestSchema,
  pluginBootstrapResultSchema,
  pluginIdRequestSchema,
  pluginManagerResultSchema,
  registerProjectRequestSchema,
  relinkProjectRequestSchema,
  renameSessionRequestSchema,
  removePluginRequestSchema,
  runIdRequestSchema,
  runtimeEventSchema,
  savedSettingsResultSchema,
  saveSettingsRequestSchema,
  saveSessionRuntimeControlsRequestSchema,
  sessionRuntimeControlsResultSchema,
  selectContextRequestSchema,
  sessionIdRequestSchema,
  sessionHistoryViewResultSchema,
  sessionRecordResultSchema,
  sessionSummaryResultSchema,
  settingsResultSchema,
  setPluginEnabledRequestSchema,
  startRunRequestSchema,
  startRunResultSchema,
  testSettingsRequestSchema,
  voidResultSchema,
  type PictorBridge,
} from '../shared/desktop-bridge.js'

const bridge = Object.freeze({
  getSnapshot: async () =>
    appSnapshotResultSchema.parse(await ipcRenderer.invoke('app:get-snapshot')),
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
  pickProjectDirectory: async () =>
    projectCandidateResultSchema.parse(await ipcRenderer.invoke('project:pick-directory')),
  registerProject: async (input) =>
    projectResultSchema.parse(
      await ipcRenderer.invoke('project:register', registerProjectRequestSchema.parse(input)),
    ),
  relinkProject: async (input) =>
    projectResultSchema.parse(
      await ipcRenderer.invoke('project:relink', relinkProjectRequestSchema.parse(input)),
    ),
  removeProject: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('project:remove', projectIdRequestSchema.parse(input)),
    ),
  selectContext: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('app:select-context', selectContextRequestSchema.parse(input)),
    ),
  createSession: async (input) =>
    sessionSummaryResultSchema.parse(
      await ipcRenderer.invoke('session:create', createSessionRequestSchema.parse(input)),
    ),
  renameSession: async (input) =>
    sessionSummaryResultSchema.parse(
      await ipcRenderer.invoke('session:rename', renameSessionRequestSchema.parse(input)),
    ),
  deleteSession: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('session:delete', sessionIdRequestSchema.parse(input)),
    ),
  getSession: async (input) =>
    sessionRecordResultSchema.parse(
      await ipcRenderer.invoke('session:get', sessionIdRequestSchema.parse(input)),
    ),
  inspectSessionHistory: async (input) =>
    sessionHistoryViewResultSchema.parse(
      await ipcRenderer.invoke(
        'session:inspect-history',
        inspectSessionHistoryRequestSchema.parse(input),
      ),
    ),
  navigateSessionTree: async (input) =>
    navigateSessionTreeResultSchema.parse(
      await ipcRenderer.invoke(
        'session:navigate-tree',
        navigateSessionTreeRequestSchema.parse(input),
      ),
    ),
  compactSession: async (input) =>
    compactSessionResultSchema.parse(
      await ipcRenderer.invoke('session:compact', compactSessionRequestSchema.parse(input)),
    ),
  cancelSessionOperation: async (input) =>
    cancelSessionOperationResultSchema.parse(
      await ipcRenderer.invoke('session:cancel-operation', sessionIdRequestSchema.parse(input)),
    ),
  getSessionRuntimeControls: async (input) =>
    sessionRuntimeControlsResultSchema.parse(
      await ipcRenderer.invoke('session:get-runtime-controls', sessionIdRequestSchema.parse(input)),
    ),
  saveSessionRuntimeControls: async (input) =>
    sessionRuntimeControlsResultSchema.parse(
      await ipcRenderer.invoke(
        'session:save-runtime-controls',
        saveSessionRuntimeControlsRequestSchema.parse(input),
      ),
    ),
  reloadSessionResources: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('session:reload-resources', sessionIdRequestSchema.parse(input)),
    ),
  labelSessionEntry: async (input) =>
    sessionHistoryViewResultSchema.parse(
      await ipcRenderer.invoke('session:label-entry', labelSessionEntryRequestSchema.parse(input)),
    ),
  forkSession: async (input) =>
    forkSessionResultSchema.parse(
      await ipcRenderer.invoke('session:fork', forkSessionRequestSchema.parse(input)),
    ),
  cloneSession: async (input) =>
    cloneSessionResultSchema.parse(
      await ipcRenderer.invoke('session:clone', cloneSessionRequestSchema.parse(input)),
    ),
  importSession: async (input) =>
    importSessionResultSchema.parse(
      await ipcRenderer.invoke('session:import', importSessionRequestSchema.parse(input)),
    ),
  exportSession: async (input) =>
    exportSessionResultSchema.parse(
      await ipcRenderer.invoke('session:export', exportSessionRequestSchema.parse(input)),
    ),
  getSettings: async () => settingsResultSchema.parse(await ipcRenderer.invoke('settings:get')),
  saveSettings: async (input) =>
    savedSettingsResultSchema.parse(
      await ipcRenderer.invoke('settings:save', saveSettingsRequestSchema.parse(input)),
    ),
  testSettings: async (input) =>
    connectionTestIpcResultSchema.parse(
      await ipcRenderer.invoke('settings:test', testSettingsRequestSchema.parse(input)),
    ),
  listModels: async (input) =>
    modelCatalogIpcResultSchema.parse(
      await ipcRenderer.invoke('settings:list-models', listModelsRequestSchema.parse(input)),
    ),
  startRun: async (input) =>
    startRunResultSchema.parse(
      await ipcRenderer.invoke('runtime:start', startRunRequestSchema.parse(input)),
    ),
  pickMessageImages: async () =>
    imageAttachmentsResultSchema.parse(await ipcRenderer.invoke('message:pick-images')),
  stopRun: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('runtime:stop', runIdRequestSchema.parse(input)),
    ),
  respondToExtensionUi: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke(
        'runtime:extension-ui-response',
        extensionUiResponseRequestSchema.parse(input),
      ),
    ),
  syncComposerText: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('runtime:composer-update', composerTextRequestSchema.parse(input)),
    ),
  queueRuntimeMessage: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke(
        'runtime:queue-message',
        queueRuntimeMessageRequestSchema.parse(input),
      ),
    ),
  clearRuntimeQueue: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('runtime:clear-queue', runIdRequestSchema.parse(input)),
    ),
  onRuntimeEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(runtimeEventSchema.parse(value))
    }
    ipcRenderer.on('runtime:event', handler)
    return () => ipcRenderer.removeListener('runtime:event', handler)
  },
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
