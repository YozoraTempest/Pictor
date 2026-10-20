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
  createSession: (projectId, title) =>
    ipcRenderer.invoke('pictor:session.create', projectId, title),
  deleteSession: (id) => ipcRenderer.invoke('pictor:session.delete', id),
  pickDirectory: () => ipcRenderer.invoke('pictor:pickDirectory'),

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
