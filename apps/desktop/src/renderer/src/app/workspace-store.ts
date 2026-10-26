import { create } from 'zustand'

import {
  readGroupingMode,
  readSectionOrder,
  readSorts,
  SETTING_KEYS,
  sortKey,
} from './settings-schema.js'

import type { ForkPoint, PluginRecord, Project, Section, Session } from '@pictor/shared'

import type { AppInfo, KernelInfo, PanelDescriptor, PluginReport } from '../../../shared/bridge.js'
import { applyToolViews } from '../features/chat/tool-views.js'
import type { GroupingMode, SectionSort } from '../features/sessions/grouping.js'

/** Presenter overrides applied from the last refresh, so a refresh can undo them. */
let disposeToolViews: (() => void) | null = null
/** A conversation that exists only in the UI until its first prompt is sent. */
export interface DraftSession {
  /** Section the new conversation should be filed under, when started from one. */
  sectionId: string | null
  projectId: string | null
}

interface WorkspaceState {
  projects: Project[]
  sessions: Session[]
  sections: Section[]
  plugins: PluginRecord[]
  panels: PanelDescriptor[]
  /**
   * Every kernel this build can drive, with what each one can do.
   *
   * Loaded with the rest of the snapshot because the composer's controls are drawn
   * from it: a conversation on a kernel without a sandbox must not show a sandbox
   * picker, and that answer has to be there before the first paint.
   */
  kernels: KernelInfo[]
  report: PluginReport | null
  info: AppInfo | null
  selectedProjectId: string | null
  selectedSessionId: string | null
  /**
   * A new conversation that has not been written yet. The session row only
   * appears once the first prompt is sent, so opening 新聊天 does not litter the
   * sidebar with empty sessions.
   */
  draft: DraftSession | null
  sorts: Record<string, SectionSort>
  /** How sections share sessions; see `GroupingMode`. */
  groupingMode: GroupingMode
  /** Sidebar section order, built-ins included (see `sectionKey`). */
  sectionOrder: string[]
  busy: boolean
  error: string | null
  notice: string | null

  refresh: () => Promise<void>
  selectProject: (id: string) => void
  /** Points the draft at another project; saved sessions keep the one they have. */
  setDraftProject: (projectId: string | null) => void
  selectSession: (id: string | null) => void
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  addProjectFolder: (id: string) => Promise<void>
  removeProjectFolder: (id: string, path: string) => Promise<void>
  /**
   * Creates a conversation on `kernelId`, or on the default kernel when it is left
   * out. The page passes its own kernel, so starting one on the Pi page produces a
   * Pi conversation.
   */
  createSession: (
    title: string,
    projectId?: string | null,
    kernelId?: string | null,
  ) => Promise<Session | null>
  /**
   * Continues the open conversation on another kernel.
   *
   * A conversation's history belongs to the kernel that produced it, so this
   * cannot move one: it opens a branch on the target kernel, filed under the same
   * project and pointing at the conversation it forked from.
   */
  branchToKernel: (kernelId: string, label: string) => Promise<Session | null>
  /** Branches a conversation and selects the copy. */
  forkSession: (sessionId: string, at?: ForkPoint) => Promise<void>
  /** Branch at a point and file the conversation left behind (undoable). */
  rewindSession: (sessionId: string, at?: ForkPoint) => Promise<void>
  startDraft: (input: { sectionId: string | null; projectId?: string | null }) => void
  clearDraft: () => void
  deleteSession: (id: string) => Promise<void>
  setSessionPinned: (id: string, pinned: boolean) => Promise<void>
  setProjectSection: (id: string, sectionId: string | null) => Promise<void>
  reorderSections: (ids: string[]) => Promise<void>
  setSessionArchived: (id: string, archived: boolean) => Promise<void>
  archiveSessions: (ids: string[]) => Promise<void>
  reorderSessions: (ids: string[]) => Promise<void>
  setSessionProject: (id: string, projectId: string | null) => Promise<void>
  setSessionSections: (id: string, sectionIds: string[]) => Promise<void>
  createSection: (name: string) => Promise<void>
  renameSection: (id: string, name: string) => Promise<void>
  removeSection: (id: string) => Promise<void>
  setSectionSort: (key: string, sort: SectionSort) => Promise<void>
  setGroupingMode: (mode: GroupingMode) => Promise<void>
  setSectionOrder: (order: string[]) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
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
  sections: [],
  plugins: [],
  panels: [],
  kernels: [],
  report: null,
  info: null,
  selectedProjectId: null,
  selectedSessionId: null,
  draft: null,
  sorts: {},
  groupingMode: 'overlap',
  sectionOrder: [],
  busy: false,
  error: null,
  notice: null,

  async refresh() {
    const [snapshot, plugins, panels, toolViews, report, info, kernels] = await Promise.all([
      window.pictor.getSnapshot(),
      window.pictor.listPlugins(),
      window.pictor.listPanels(),
      window.pictor.listToolViews(),
      window.pictor.pluginReport(),
      window.pictor.getAppInfo(),
      window.pictor.listKernels(),
    ])

    // Views are presentation overrides, so re-applying them must replace the
    // previous set instead of stacking another layer on every refresh.
    disposeToolViews?.()
    disposeToolViews = applyToolViews(toolViews)

    const currentProject = get().selectedProjectId
    const projectId =
      currentProject !== null && snapshot.projects.some((project) => project.id === currentProject)
        ? currentProject
        : (snapshot.projects[0]?.id ?? null)

    // The selection is not restored from the profile. A kernel's page opens one of its
    // own conversations; nothing else should conjure a transcript the page never asked
    // for — least of all home, which keeps no list to explain where it came from.
    const currentSession = get().selectedSessionId
    const sessionId =
      currentSession !== null && snapshot.sessions.some((session) => session.id === currentSession)
        ? currentSession
        : null

    set({
      projects: snapshot.projects,
      sessions: snapshot.sessions,
      sections: snapshot.sections,
      plugins,
      panels,
      kernels,
      report,
      info,
      selectedProjectId: projectId,
      selectedSessionId: sessionId,
      sorts: readSorts(snapshot.settings),
      groupingMode: readGroupingMode(snapshot.settings),
      sectionOrder: readSectionOrder(snapshot.settings),
    })
  },

  selectProject(id) {
    const sessionId = get().sessions.find((session) => session.projectId === id)?.id ?? null
    set({ selectedProjectId: id, selectedSessionId: sessionId, draft: null })
  },

  selectSession(id) {
    // Keep the "current project" in step with the open session: it feeds the
    // breadcrumb and the agent test panel, and a stale value used to leak a
    // project onto sessions that belong to none.
    const projectId = get().sessions.find((session) => session.id === id)?.projectId ?? null
    set({ selectedSessionId: id, selectedProjectId: projectId, draft: null })
  },

  /**
   * Opens an unsaved conversation. The project defaults to the one the user is
   * already in, or — when started from a section — the project of that section's
   * most recent conversation.
   */
  startDraft({ sectionId, projectId }) {
    const state = get()
    const fromSection =
      sectionId === null
        ? null
        : ([...state.sessions]
            .filter((session) => !session.archived && session.sectionIds.includes(sectionId))
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.projectId ?? null)

    set({
      draft: {
        sectionId,
        projectId: projectId === undefined ? (fromSection ?? state.selectedProjectId) : projectId,
      },
      selectedSessionId: null,
    })
  },

  clearDraft() {
    set({ draft: null })
  },

  setDraftProject(projectId) {
    const draft = get().draft
    if (draft === null) return

    set({ draft: { ...draft, projectId }, selectedProjectId: projectId })
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

  async createSession(title, projectId, kernelId = null) {
    const target = projectId === undefined ? get().selectedProjectId : projectId
    let created: Session | null = null

    await guard(set, async () => {
      created = await window.pictor.createSession(target, title, kernelId ?? undefined)
      // The conversation exists now, so any draft that was open has been spent.
      set({ selectedSessionId: created.id, draft: null })
      await get().refresh()
    })

    return created
  },

  async branchToKernel(kernelId, label) {
    const state = get()
    const source = state.sessions.find((entry) => entry.id === state.selectedSessionId) ?? null
    if (source === null) return null

    let created: Session | null = null
    await guard(set, async () => {
      created = await window.pictor.createSession(
        source.projectId,
        `${source.title} · ${label}`,
        kernelId,
        source.id,
      )
      set({ selectedSessionId: created.id })
      await get().refresh()
    })
    return created
  },

  async forkSession(sessionId, at) {
    await guard(set, async () => {
      const created = await window.pictor.forkSession(sessionId, at)
      set({ selectedSessionId: created })
      await get().refresh()
    })
  },

  async rewindSession(sessionId, at) {
    await guard(set, async () => {
      const result = await window.pictor.rewindSession(sessionId, at)
      set({
        selectedSessionId: result.id,
        // The old conversation is not gone — it is filed. Saying that, and how to get it
        // back, is the difference between "rewind" and "the app ate my work".
        notice: result.archived
          ? '已回到这里；原来的会话已归档，可在「已归档」里恢复'
          : '已回到这里，但原来的会话没有归档成功，请手动归档',
      })
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

  async setProjectSection(id, sectionId) {
    await guard(set, async () => {
      await window.pictor.setProjectSection(id, sectionId)
      await get().refresh()
    })
  },

  async reorderSections(ids) {
    await guard(set, async () => {
      await window.pictor.reorderSections(ids)
      await get().refresh()
    })
  },

  async setSessionArchived(id, archived) {
    await guard(set, async () => {
      await window.pictor.setSessionArchived(id, archived)
      await get().refresh()
    })
  },

  async reorderSessions(ids) {
    await guard(set, async () => {
      if (ids.length === 0) return
      await window.pictor.reorderSessions(ids)
      await get().refresh()
    })
  },

  async archiveSessions(ids) {
    await guard(set, async () => {
      if (ids.length === 0) return
      await window.pictor.archiveSessions(ids)
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

  async setSectionSort(key, sort) {
    set((state) => ({ sorts: { ...state.sorts, [key]: sort } }))
    await window.pictor.putSetting(sortKey(key), sort)
  },

  async setSectionOrder(sectionOrder) {
    set({ sectionOrder })
    await window.pictor.putSetting(SETTING_KEYS.sectionOrder, sectionOrder)
  },

  async setGroupingMode(groupingMode) {
    set({ groupingMode })
    await window.pictor.putSetting(SETTING_KEYS.grouping, groupingMode)
  },

  async setPluginEnabled(id, enabled) {
    await guard(set, async () => {
      await window.pictor.setPluginEnabled(id, enabled)
      await get().refresh()
    })
  },

  setNotice(notice) {
    set({ notice })
  },

  setError(error) {
    set({ error })
  },
}))
