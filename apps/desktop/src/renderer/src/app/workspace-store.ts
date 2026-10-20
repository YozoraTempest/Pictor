import { create } from 'zustand'

import type { PluginRecord, Project, Section, Session, SessionGrouping } from '@pictor/shared'

import type { AppInfo, CommandDescriptor, PluginReport } from '../../../shared/bridge.js'

interface WorkspaceState {
  projects: Project[]
  sessions: Session[]
  sections: Section[]
  plugins: PluginRecord[]
  commands: CommandDescriptor[]
  report: PluginReport | null
  info: AppInfo | null
  selectedProjectId: string | null
  selectedSessionId: string | null
  grouping: SessionGrouping
  groupingExclusive: boolean
  busy: boolean
  error: string | null
  notice: string | null

  refresh: () => Promise<void>
  selectProject: (id: string) => void
  selectSession: (id: string | null) => void
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  addProjectFolder: (id: string) => Promise<void>
  removeProjectFolder: (id: string, path: string) => Promise<void>
  createSession: (title: string, projectId?: string | null) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  setSessionPinned: (id: string, pinned: boolean) => Promise<void>
  setSessionProject: (id: string, projectId: string | null) => Promise<void>
  setSessionSections: (id: string, sectionIds: string[]) => Promise<void>
  createSection: (name: string) => Promise<void>
  renameSection: (id: string, name: string) => Promise<void>
  removeSection: (id: string) => Promise<void>
  setGrouping: (grouping: SessionGrouping) => Promise<void>
  setGroupingExclusive: (exclusive: boolean) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
  runCommand: (id: string) => Promise<void>
  setNotice: (notice: string | null) => void
  setError: (error: string | null) => void
}

const GROUPINGS: SessionGrouping[] = ['project', 'section', 'recent']

function readGrouping(value: unknown): SessionGrouping {
  return GROUPINGS.find((entry) => entry === value) ?? 'project'
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
  sections: [],
  plugins: [],
  commands: [],
  report: null,
  info: null,
  selectedProjectId: null,
  selectedSessionId: null,
  grouping: 'project',
  groupingExclusive: false,
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
      sections: snapshot.sections,
      plugins,
      commands,
      report,
      info,
      selectedProjectId: projectId,
      selectedSessionId: sessionId,
      grouping: readGrouping(snapshot.settings['sessions.grouping']),
      groupingExclusive: snapshot.settings['sessions.groupingExclusive'] === true,
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

  async addProjectFolder(id) {
    await guard(set, async () => {
      const path = await window.pictor.pickDirectory()
      if (path === null) return
      await window.pictor.addProjectFolder(id, path)
      await get().refresh()
    })
  },

  async removeProjectFolder(id, path) {
    await guard(set, async () => {
      await window.pictor.removeProjectFolder(id, path)
      await get().refresh()
    })
  },

  async createSession(title, projectId) {
    await guard(set, async () => {
      const target = projectId === undefined ? get().selectedProjectId : projectId
      const session = await window.pictor.createSession(target, title)
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

  async setSessionPinned(id, pinned) {
    await guard(set, async () => {
      await window.pictor.setSessionPinned(id, pinned)
      await get().refresh()
    })
  },

  async setSessionProject(id, projectId) {
    await guard(set, async () => {
      await window.pictor.setSessionProject(id, projectId)
      await get().refresh()
    })
  },

  async setSessionSections(id, sectionIds) {
    await guard(set, async () => {
      await window.pictor.setSessionSections(id, sectionIds)
      await get().refresh()
    })
  },

  async createSection(name) {
    await guard(set, async () => {
      await window.pictor.createSection(name)
      await get().refresh()
    })
  },

  async renameSection(id, name) {
    await guard(set, async () => {
      await window.pictor.renameSection(id, name)
      await get().refresh()
    })
  },

  async removeSection(id) {
    await guard(set, async () => {
      await window.pictor.removeSection(id)
      await get().refresh()
    })
  },

  async setGrouping(grouping) {
    set({ grouping })
    await window.pictor.putSetting('sessions.grouping', grouping)
  },

  async setGroupingExclusive(groupingExclusive) {
    set({ groupingExclusive })
    await window.pictor.putSetting('sessions.groupingExclusive', groupingExclusive)
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
