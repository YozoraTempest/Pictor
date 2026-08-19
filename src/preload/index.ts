import { contextBridge, ipcRenderer } from 'electron'

import {
  moduleEventEnvelopeSchema,
  moduleInvocationSchema,
  type ModuleTransport,
} from '../kernel/contract.js'
import {
  approvalResolutionRequestSchema,
  appSnapshotResultSchema,
  connectionTestIpcResultSchema,
  createSessionRequestSchema,
  listModelsRequestSchema,
  modelCatalogIpcResultSchema,
  projectCandidateResultSchema,
  projectIdRequestSchema,
  projectResultSchema,
  registerProjectRequestSchema,
  relinkProjectRequestSchema,
  renameSessionRequestSchema,
  runIdRequestSchema,
  runtimeEventSchema,
  savedSettingsResultSchema,
  saveSettingsRequestSchema,
  selectContextRequestSchema,
  sessionIdRequestSchema,
  sessionRecordResultSchema,
  sessionSummaryResultSchema,
  settingsResultSchema,
  startRunRequestSchema,
  startRunResultSchema,
  testSettingsRequestSchema,
  voidResultSchema,
  type PictorBridge,
} from '../shared/desktop-bridge.js'

const bridge = Object.freeze({
  getSnapshot: async () =>
    appSnapshotResultSchema.parse(await ipcRenderer.invoke('app:get-snapshot')),
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
  approveCommand: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('runtime:approve', approvalResolutionRequestSchema.parse(input)),
    ),
  rejectCommand: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('runtime:reject', approvalResolutionRequestSchema.parse(input)),
    ),
  stopRun: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('runtime:stop', runIdRequestSchema.parse(input)),
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
