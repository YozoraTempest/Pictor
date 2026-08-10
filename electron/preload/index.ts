import { contextBridge, ipcRenderer } from 'electron'

import {
  appInfoSchema,
  appSnapshotResultSchema,
  connectionTestIpcResultSchema,
  createSessionRequestSchema,
  projectCandidateResultSchema,
  projectIdRequestSchema,
  projectResultSchema,
  registerProjectRequestSchema,
  renameSessionRequestSchema,
  savedSettingsResultSchema,
  saveSettingsRequestSchema,
  sessionIdRequestSchema,
  sessionRecordResultSchema,
  sessionSummaryResultSchema,
  settingsResultSchema,
  testSettingsRequestSchema,
  voidResultSchema,
  type PictorBridge,
} from '../../src/shared/contracts.js'

const bridge = Object.freeze({
  getAppInfo: async () => appInfoSchema.parse(await ipcRenderer.invoke('app:get-info')),
  getSnapshot: async () =>
    appSnapshotResultSchema.parse(await ipcRenderer.invoke('app:get-snapshot')),
  pickProjectDirectory: async () =>
    projectCandidateResultSchema.parse(await ipcRenderer.invoke('project:pick-directory')),
  registerProject: async (input) =>
    projectResultSchema.parse(
      await ipcRenderer.invoke('project:register', registerProjectRequestSchema.parse(input)),
    ),
  removeProject: async (input) =>
    voidResultSchema.parse(
      await ipcRenderer.invoke('project:remove', projectIdRequestSchema.parse(input)),
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
} satisfies PictorBridge)

contextBridge.exposeInMainWorld('pictor', bridge)
