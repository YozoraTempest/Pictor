import { contextBridge, ipcRenderer } from 'electron'

import type { PictorBridge } from '../shared/bridge.js'

/**
 * A rejection carries Electron's own sentence in front of the one main wrote
 * (`Error invoking remote method 'pictor:chat.send': Error: …`). The page shows
 * what main said, because that is the sentence written for a person.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (reason) {
    const text = reason instanceof Error ? reason.message : String(reason)
    throw new Error(text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''))
  }
}

/**
 * The bridge is deliberately narrow: one method per IPC channel, no raw
 * `ipcRenderer`, and no Node object reachable from the page.
 */
const bridge: PictorBridge = {
  getSnapshot: () => invoke('pictor:snapshot'),
  addProject: (path, name) => invoke('pictor:project.add', path, name),
  removeProject: (id) => invoke('pictor:project.remove', id),
  setProjectSection: (id, sectionId) => invoke('pictor:project.setSection', id, sectionId),
  reorderSections: (ids) => invoke('pictor:sections.reorder', ids),
  addProjectFolder: (id, path) => invoke('pictor:project.addFolder', id, path),
  removeProjectFolder: (id, path) => invoke('pictor:project.removeFolder', id, path),
  createSession: (projectId, title, kernelId, parentId) =>
    invoke('pictor:session.create', projectId, title, kernelId, parentId),
  deleteSession: (id) => invoke('pictor:session.delete', id),
  setSessionPinned: (id, pinned) => invoke('pictor:session.setPinned', id, pinned),
  setSessionArchived: (id, archived) => invoke('pictor:session.setArchived', id, archived),
  archiveSessions: (ids) => invoke('pictor:session.archiveMany', ids),
  reorderSessions: (ids) => invoke('pictor:session.reorder', ids),
  setSessionProject: (id, projectId) => invoke('pictor:session.setProject', id, projectId),
  setSessionSections: (id, sectionIds) => invoke('pictor:session.setSections', id, sectionIds),
  pickDirectory: () => invoke('pictor:pickDirectory'),

  listSections: () => invoke('pictor:sections.list'),
  createSection: (name) => invoke('pictor:sections.create', name),
  renameSection: (id, name) => invoke('pictor:sections.rename', id, name),
  removeSection: (id) => invoke('pictor:sections.remove', id),

  putSetting: (key, value) => invoke('pictor:settings.put', key, value),

  windowCommand: (command) => invoke('pictor:window.command', command),
  getWindowState: () => invoke('pictor:window.state'),
  onWindowState: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:window.state', handler)
    return () => {
      ipcRenderer.removeListener('pictor:window.state', handler)
    }
  },

  listPanels: () => invoke('pictor:panels.list'),
  invokePanel: (id) => invoke('pictor:panels.invoke', id),
  listToolViews: () => invoke('pictor:toolViews.list'),

  listPlugins: () => invoke('pictor:plugins.list'),
  setPluginEnabled: (id, enabled) => invoke('pictor:plugins.setEnabled', id, enabled),
  pluginReport: () => invoke('pictor:plugins.report'),

  harnessStatus: () => invoke('pictor:harness.status'),
  harnessStart: (cwd) => invoke('pictor:harness.start', cwd),
  harnessStop: () => invoke('pictor:harness.stop'),
  installHarness: () => invoke('pictor:harness.install'),
  setHarnessPermissionMode: (mode) => invoke('pictor:harness.setPermissionMode', mode),
  getSessionPermission: (sessionId) => invoke('pictor:harness.sessionPermission', sessionId),
  setSessionPermission: (sessionId, mode) =>
    invoke('pictor:harness.setSessionPermission', sessionId, mode),
  listKernels: () => invoke('pictor:kernels.list'),
  listKernelPlugins: () => invoke('pictor:kernels.plugins'),
  listPluginOverview: () => invoke('pictor:plugins.overview'),
  listBuiltinKernels: () => invoke('pictor:kernels.builtins'),
  setBuiltinKernelEnabled: (id, enabled) => invoke('pictor:kernels.setBuiltinEnabled', id, enabled),
  setDefaultKernel: (id) => invoke('pictor:kernels.setDefault', id),
  chooseKernelFolder: () => invoke('pictor:kernels.chooseFolder'),
  installKernelFolder: (path) => invoke('pictor:kernels.installFolder', path),
  installKernelPackage: (spec) => invoke('pictor:kernels.installPackage', spec),
  removeKernel: (id) => invoke('pictor:kernels.remove', id),
  kernelStatuses: () => invoke('pictor:kernels.statuses'),
  kernelSettings: () => invoke('pictor:kernels.settings'),
  setKernelSetting: (key, value) => invoke('pictor:kernels.setSetting', key, value),
  kernelModels: (sessionId) => invoke('pictor:kernel.models', sessionId),
  selectKernelModel: (sessionId, id) => invoke('pictor:kernel.selectModel', sessionId, id),
  selectKernelEffort: (sessionId, effort) =>
    invoke('pictor:kernel.selectEffort', sessionId, effort),
  kernelApproval: (sessionId) => invoke('pictor:kernel.approval', sessionId),
  selectKernelApproval: (sessionId, mode) =>
    invoke('pictor:kernel.selectApproval', sessionId, mode),
  kernelGrants: (sessionId) => invoke('pictor:kernel.grants', sessionId),
  grantKernelTool: (sessionId, tool) => invoke('pictor:kernel.grantTool', sessionId, tool),
  revokeKernelGrants: (sessionId) => invoke('pictor:kernel.revokeGrants', sessionId),
  listToolRules: () => invoke('pictor:rules.list'),
  saveToolRules: (rules) => invoke('pictor:rules.save', rules),
  listSkills: (sessionId) => invoke('pictor:harness.skills', sessionId),
  setSkillEnabled: (sessionId, name, enabled) =>
    invoke('pictor:harness.skillEnabled', sessionId, name, enabled),
  showInFolder: (path) => invoke('pictor:shell.showItem', path),

  getAppInfo: () => invoke('pictor:appInfo'),

  getModelSettings: () => invoke('pictor:model.get'),
  listProviders: () => invoke('pictor:provider.list'),
  saveProvider: (input) => invoke('pictor:provider.save', input),
  removeProvider: (id) => invoke('pictor:provider.remove', id),
  activateProvider: (id) => invoke('pictor:provider.activate', id),
  selectModel: (modelId) => invoke('pictor:model.select', modelId),
  useModel: (providerId, modelId) => invoke('pictor:model.use', providerId, modelId),
  saveModelSettings: (input) => invoke('pictor:model.save', input),
  fetchModels: (input) => invoke('pictor:model.fetch', input),
  testModelConnection: () => invoke('pictor:model.test'),
  scanCcSwitch: () => invoke('pictor:model.ccswitch.scan'),
  importCcSwitchProvider: (id, includeApiKey) =>
    invoke('pictor:model.ccswitch.import', id, includeApiKey),
  runAgentTest: (prompt, workingDirectory) =>
    invoke('pictor:model.agentTest', prompt, workingDirectory),

  openChat: (sessionId) => invoke('pictor:chat.open', sessionId),
  sendChat: (sessionId, prompt, images, effort) =>
    invoke('pictor:chat.send', sessionId, prompt, images, effort),
  stopChat: (sessionId) => invoke('pictor:chat.stop', sessionId),
  forkSession: (sessionId, atSeq) => invoke('pictor:session.fork', sessionId, atSeq),
  chatHistory: (path, limit, offset) => invoke('pictor:chat.history', path, limit, offset),
  onChatEvent: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:chat.event', handler)
    return () => {
      ipcRenderer.removeListener('pictor:chat.event', handler)
    }
  },
  onWorkspaceChanged: (listener) => {
    const handler = (): void => {
      listener()
    }
    ipcRenderer.on('pictor:workspace.changed', handler)
    return () => {
      ipcRenderer.removeListener('pictor:workspace.changed', handler)
    }
  },
  onApprovalRequest: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:harness.approval', handler)
    return () => {
      ipcRenderer.removeListener('pictor:harness.approval', handler)
    }
  },
  answerApproval: (eventId, allow) => invoke('pictor:harness.approvalAnswer', eventId, allow),
  onQuestionRequest: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:harness.question', handler)
    return () => {
      ipcRenderer.removeListener('pictor:harness.question', handler)
    }
  },
  answerQuestions: (eventId, answers) => invoke('pictor:harness.questionAnswer', eventId, answers),
  onHarnessInstall: (listener) => {
    const handler = (_event: unknown, line: unknown): void => {
      if (typeof line === 'string') listener(line)
    }
    ipcRenderer.on('pictor:harness.install', handler)
    return () => ipcRenderer.removeListener('pictor:harness.install', handler)
  },
  onKernelNotice: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:kernel.notice', handler)
    return () => ipcRenderer.removeListener('pictor:kernel.notice', handler)
  },
  onHarnessStatus: (listener) => {
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('pictor:harness.status', handler)
    return () => {
      ipcRenderer.removeListener('pictor:harness.status', handler)
    }
  },
}

contextBridge.exposeInMainWorld('pictor', bridge)
