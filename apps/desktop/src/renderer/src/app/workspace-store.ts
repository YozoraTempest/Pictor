import { create } from 'zustand'

import type { PluginRecord, Project, Session } from '@pictor/shared'

import type { AppInfo, CommandDescriptor, PluginReport } from '../../../shared/bridge.js'

interface WorkspaceState {
  projects: Project[]
  sessions: Session[]
  plugins: PluginRecord[]
  commands: CommandDescriptor[]
  report: PluginReport | null
  info: AppInfo | null
  selectedProjectId: string | null
  selectedSessionId: string | null
  busy: boolean
  error: string | null
  notice: string | null

  refresh: () => Promise<void>
  selectProject: (id: string) => void
  selectSession: (id: string | null) => void
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  createSession: (title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
  runCommand: (id: string) => Promise<void>
  setNotice: (notice: string | null) => void
  setError: (error: string | null) => void
}

async function guard(
  set: (partial: Partial<WorkspaceState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  set({ busy: true, error: null })
  try {
    await action()
  } catch (reason) {
    set({ error: reason instanceof Error ? reason.message : String(reason) })
  } finally {
    set({ busy: false })
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  projects: [],
  sessions: [],
  plugins: [],
  commands: [],
  report: null,
  info: null,
  selectedProjectId: null,
  selectedSessionId: null,
  busy: false,
  error: null,
  notice: null,

  async refresh() {
    const [snapshot, plugins, commands, report, info] = await Promise.all([
      window.pictor.getSnapshot(),
      window.pictor.listPlugins(),
      window.pictor.listCommands(),
      window.pictor.pluginReport(),
      window.pictor.getAppInfo(),
    ])

    const currentProject = get().selectedProjectId
    const projectId =
      currentProject !== null && snapshot.projects.some((project) => project.id === currentProject)
        ? currentProject
        : (snapshot.projects[0]?.id ?? null)

    const currentSession = get().selectedSessionId
    const sessionId =
      currentSession !== null && snapshot.sessions.some((session) => session.id === currentSession)
        ? currentSession
        : (snapshot.sessions.find((session) => session.projectId === projectId)?.id ?? null)

    set({
      projects: snapshot.projects,
      sessions: snapshot.sessions,
      plugins,
      commands,
      report,
      info,
      selectedProjectId: projectId,
      selectedSessionId: sessionId,
    })
  },

  selectProject(id) {
    const sessionId = get().sessions.find((session) => session.projectId === id)?.id ?? null
    set({ selectedProjectId: id, selectedSessionId: sessionId })
  },

  selectSession(id) {
    set({ selectedSessionId: id })
  },

  async addProject() {
    await guard(set, async () => {
      const path = await window.pictor.pickDirectory()
      if (path === null) return
      const project = await window.pictor.addProject(path)
      set({ selectedProjectId: project.id, selectedSessionId: null })
      await get().refresh()
    })
  },

  async removeProject(id) {
    await guard(set, async () => {
      await window.pictor.removeProject(id)
      await get().refresh()
    })
  },

  async createSession(title) {
    const projectId = get().selectedProjectId
    if (projectId === null) return

    await guard(set, async () => {
      const session = await window.pictor.createSession(projectId, title)
      set({ selectedSessionId: session.id })
      await get().refresh()
    })
  },

  async deleteSession(id) {
    await guard(set, async () => {
      await window.pictor.deleteSession(id)
      if (get().selectedSessionId === id) set({ selectedSessionId: null })
      await get().refresh()
    })
  },

  async setPluginEnabled(id, enabled) {
    await guard(set, async () => {
      await window.pictor.setPluginEnabled(id, enabled)
      await get().refresh()
    })
  },

  async runCommand(id) {
    await guard(set, async () => {
      const result = await window.pictor.executeCommand(id, {})
      set({ notice: `${id} → ${JSON.stringify(result)}` })
    })
  },

  setNotice(notice) {
    set({ notice })
  },

  setError(error) {
    set({ error })
  },
}))
