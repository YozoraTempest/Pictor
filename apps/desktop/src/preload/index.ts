import { contextBridge, ipcRenderer } from 'electron'

import type { JsonValue } from '@pictor/shared'

import type { PictorBridge } from '../shared/bridge.js'

/**
 * The bridge is deliberately narrow: one method per IPC channel, no raw
 * `ipcRenderer`, and no Node object reachable from the page.
 */
const bridge: PictorBridge = {
  getSnapshot: () => ipcRenderer.invoke('pictor:snapshot'),
  addProject: (path, name) => ipcRenderer.invoke('pictor:project.add', path, name),
  removeProject: (id) => ipcRenderer.invoke('pictor:project.remove', id),
  addProjectFolder: (id, path) => ipcRenderer.invoke('pictor:project.addFolder', id, path),
  removeProjectFolder: (id, path) => ipcRenderer.invoke('pictor:project.removeFolder', id, path),
  createSession: (projectId, title) =>
    ipcRenderer.invoke('pictor:session.create', projectId, title),
  deleteSession: (id) => ipcRenderer.invoke('pictor:session.delete', id),
  setSessionPinned: (id, pinned) => ipcRenderer.invoke('pictor:session.setPinned', id, pinned),
  setSessionArchived: (id, archived) =>
    ipcRenderer.invoke('pictor:session.setArchived', id, archived),
  archiveSessions: (ids) => ipcRenderer.invoke('pictor:session.archiveMany', ids),
  setSessionProject: (id, projectId) =>
    ipcRenderer.invoke('pictor:session.setProject', id, projectId),
  setSessionSections: (id, sectionIds) =>
    ipcRenderer.invoke('pictor:session.setSections', id, sectionIds),
  pickDirectory: () => ipcRenderer.invoke('pictor:pickDirectory'),

  listSections: () => ipcRenderer.invoke('pictor:sections.list'),
  createSection: (name) => ipcRenderer.invoke('pictor:sections.create', name),
  renameSection: (id, name) => ipcRenderer.invoke('pictor:sections.rename', id, name),
  removeSection: (id) => ipcRenderer.invoke('pictor:sections.remove', id),

  putSetting: (key, value) => ipcRenderer.invoke('pictor:settings.put', key, value),

  listCommands: () => ipcRenderer.invoke('pictor:commands.list'),
  executeCommand: (id, input) =>
    ipcRenderer.invoke('pictor:commands.execute', id, input as JsonValue | undefined),

  listPlugins: () => ipcRenderer.invoke('pictor:plugins.list'),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('pictor:plugins.setEnabled', id, enabled),
  pluginReport: () => ipcRenderer.invoke('pictor:plugins.report'),

  getAppInfo: () => ipcRenderer.invoke('pictor:appInfo'),

  getModelSettings: () => ipcRenderer.invoke('pictor:model.get'),
  saveModelSettings: (input) => ipcRenderer.invoke('pictor:model.save', input),
  fetchModels: (input) => ipcRenderer.invoke('pictor:model.fetch', input),
  testModelConnection: () => ipcRenderer.invoke('pictor:model.test'),
  scanCcSwitch: () => ipcRenderer.invoke('pictor:model.ccswitch.scan'),
  importCcSwitchProvider: (id, includeApiKey) =>
    ipcRenderer.invoke('pictor:model.ccswitch.import', id, includeApiKey),
  runAgentTest: (prompt, workingDirectory) =>
    ipcRenderer.invoke('pictor:model.agentTest', prompt, workingDirectory),

  openChat: (sessionId) => ipcRenderer.invoke('pictor:chat.open', sessionId),
  sendChat: (prompt) => ipcRenderer.invoke('pictor:chat.send', prompt),
  stopChat: () => ipcRenderer.invoke('pictor:chat.stop'),
  closeChat: () => ipcRenderer.invoke('pictor:chat.close'),
  chatHistory: (path, limit, offset) =>
    ipcRenderer.invoke('pictor:chat.history', path, limit, offset),
  onChatEvent: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:chat.event', handler)
    return () => {
      ipcRenderer.removeListener('pictor:chat.event', handler)
    }
  },
}

contextBridge.exposeInMainWorld('pictor', bridge)
