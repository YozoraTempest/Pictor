import type { JsonValue, Project, Section, Session, SettingsMap } from '@pictor/shared'

import { CommandEngine } from './command-engine.js'
import { EventBus } from './events.js'

export interface ApplicationStore {
  listProjects(): Promise<Project[]>
  addProject(path: string, name?: string): Promise<Project>
  removeProject(id: string): Promise<void>
  setProjectSection(id: string, sectionId: string | null): Promise<Project>
  reorderSections(ids: string[]): Promise<Section[]>
  addProjectFolder(id: string, path: string): Promise<string[]>
  removeProjectFolder(id: string, path: string): Promise<string[]>
  listSessions(projectId?: string): Promise<Session[]>
  createSession(projectId: string | null, title: string): Promise<Session>
  setSessionPinned(id: string, pinned: boolean): Promise<Session>
  setSessionArchived(id: string, archived: boolean): Promise<Session>
  archiveSessions(ids: string[]): Promise<number>
  setSessionProject(id: string, projectId: string | null): Promise<Session>
  setSessionSections(id: string, sectionIds: string[]): Promise<Session>
  deleteSession(id: string): Promise<void>
  listSections(): Promise<Section[]>
  createSection(name: string): Promise<Section>
  renameSection(id: string, name: string): Promise<Section>
  removeSection(id: string): Promise<void>
  listSettings(): Promise<SettingsMap>
  putSetting(key: string, value: JsonValue): Promise<void>
}

export interface ApplicationEvents {
  'project.added': Project
  'project.removed': { id: string }
  'session.created': Session
  'session.updated': Session
  'session.deleted': { id: string }
}

export interface ApplicationSnapshot {
  projects: Project[]
  sessions: Session[]
  sections: Section[]
  settings: SettingsMap
}

function requireId(input: unknown, command: string): string {
  const params = input as { id?: unknown } | undefined
  if (typeof params?.id !== 'string') {
    throw new Error(`${command} requires an id`)
  }
  return params.id
}

function requireName(input: unknown, command: string): string {
  const params = input as { name?: unknown } | undefined
  if (typeof params?.name !== 'string' || params.name.trim().length === 0) {
    throw new Error(`${command} requires a non-empty name`)
  }
  return params.name
}

/**
 * Headless application core.
 *
 * It owns no window, no DOM and no IPC. Every frontend (Electron renderer,
 * future CLI or TUI) drives the same instance through this class.
 */
export class ApplicationHost {
  readonly commands = new CommandEngine()
  readonly events = new EventBus<ApplicationEvents>()
  readonly #store: ApplicationStore

  constructor(store: ApplicationStore) {
    this.#store = store
    this.#registerCoreCommands()
  }

  async snapshot(): Promise<ApplicationSnapshot> {
    const [projects, sessions, sections, settings] = await Promise.all([
      this.#store.listProjects(),
      this.#store.listSessions(),
      this.#store.listSections(),
      this.#store.listSettings(),
    ])

    return { projects, sessions, sections, settings }
  }

  #registerCoreCommands(): void {
    this.commands.register<void, Project>({
      id: 'project.add',
      description: 'Register a local directory as a Pictor project',
      handler: async (input) => {
        const params = input as { path?: unknown; name?: unknown } | undefined
        if (typeof params?.path !== 'string' || params.path.trim().length === 0) {
          throw new Error('project.add requires a non-empty path')
        }

        const name = typeof params.name === 'string' ? params.name : undefined
        const project = await this.#store.addProject(params.path, name)
        this.events.emit('project.added', project)
        return project
      },
    })

    this.commands.register<void, { removed: string }>({
      id: 'project.remove',
      description: 'Remove a project and its sessions without touching files',
      handler: async (input) => {
        const id = requireId(input, 'project.remove')
        await this.#store.removeProject(id)
        this.events.emit('project.removed', { id })
        return { removed: id }
      },
    })

    this.commands.register<void, Project>({
      id: 'project.setSection',
      description: 'Move a project into a section, or back to the default one',
      handler: async (input) => {
        const params = input as { id?: unknown; sectionId?: unknown } | undefined
        if (
          params?.sectionId !== undefined &&
          params.sectionId !== null &&
          typeof params.sectionId !== 'string'
        ) {
          throw new Error('project.setSection sectionId must be a string or null')
        }
        const sectionId = typeof params?.sectionId === 'string' ? params.sectionId : null
        return this.#store.setProjectSection(requireId(input, 'project.setSection'), sectionId)
      },
    })

    this.commands.register<void, Section[]>({
      id: 'section.reorder',
      description: 'Persist a new order for the custom sections',
      handler: async (input) => {
        const params = input as { ids?: unknown } | undefined
        if (!Array.isArray(params?.ids)) {
          throw new Error('section.reorder requires an ids array')
        }
        const ids = params.ids.filter((value): value is string => typeof value === 'string')
        return this.#store.reorderSections(ids)
      },
    })

    this.commands.register<void, string[]>({
      id: 'project.addFolder',
      description: 'Register an extra working directory on a project',
      handler: async (input) => {
        const params = input as { id?: unknown; path?: unknown } | undefined
        if (typeof params?.path !== 'string' || params.path.trim().length === 0) {
          throw new Error('project.addFolder requires an id and a path')
        }
        return this.#store.addProjectFolder(requireId(input, 'project.addFolder'), params.path)
      },
    })

    this.commands.register<void, string[]>({
      id: 'project.removeFolder',
      description: 'Detach an extra working directory from a project',
      handler: async (input) => {
        const params = input as { id?: unknown; path?: unknown } | undefined
        if (typeof params?.path !== 'string') {
          throw new Error('project.removeFolder requires an id and a path')
        }
        return this.#store.removeProjectFolder(
          requireId(input, 'project.removeFolder'),
          params.path,
        )
      },
    })

    this.commands.register<void, Session>({
      id: 'session.create',
      description: 'Create a session, optionally inside a project',
      handler: async (input) => {
        const params = input as { projectId?: unknown; title?: unknown } | undefined
        if (typeof params?.title !== 'string') {
          throw new Error('session.create requires a title')
        }
        if (
          params.projectId !== undefined &&
          params.projectId !== null &&
          typeof params.projectId !== 'string'
        ) {
          throw new Error('session.create projectId must be a string or null')
        }

        const projectId = typeof params.projectId === 'string' ? params.projectId : null
        const session = await this.#store.createSession(projectId, params.title)
        this.events.emit('session.created', session)
        return session
      },
    })

    this.commands.register<void, Session>({
      id: 'session.setPinned',
      description: 'Pin or unpin a session so it stays at the top',
      handler: async (input) => {
        const params = input as { id?: unknown; pinned?: unknown } | undefined
        if (typeof params?.pinned !== 'boolean') {
          throw new Error('session.setPinned requires a pinned boolean')
        }
        const session = await this.#store.setSessionPinned(
          requireId(input, 'session.setPinned'),
          params.pinned,
        )
        this.events.emit('session.updated', session)
        return session
      },
    })

    this.commands.register<void, Session>({
      id: 'session.setArchived',
      description: 'Archive or restore a session',
      handler: async (input) => {
        const params = input as { id?: unknown; archived?: unknown } | undefined
        if (typeof params?.archived !== 'boolean') {
          throw new Error('session.setArchived requires an archived boolean')
        }
        const session = await this.#store.setSessionArchived(
          requireId(input, 'session.setArchived'),
          params.archived,
        )
        this.events.emit('session.updated', session)
        return session
      },
    })

    this.commands.register<void, { archived: number }>({
      id: 'session.archiveMany',
      description: 'Archive every given session, used by "archive this section"',
      handler: async (input) => {
        const params = input as { ids?: unknown } | undefined
        if (!Array.isArray(params?.ids)) {
          throw new Error('session.archiveMany requires an ids array')
        }
        const ids = params.ids.filter((value): value is string => typeof value === 'string')
        const archived = await this.#store.archiveSessions(ids)
        return { archived }
      },
    })

    this.commands.register<void, Session>({
      id: 'session.setProject',
      description: 'Move a session into a project, or detach it',
      handler: async (input) => {
        const params = input as { id?: unknown; projectId?: unknown } | undefined
        if (
          params?.projectId !== undefined &&
          params.projectId !== null &&
          typeof params.projectId !== 'string'
        ) {
          throw new Error('session.setProject projectId must be a string or null')
        }

        const projectId = typeof params?.projectId === 'string' ? params.projectId : null
        const session = await this.#store.setSessionProject(
          requireId(input, 'session.setProject'),
          projectId,
        )
        this.events.emit('session.updated', session)
        return session
      },
    })

    this.commands.register<void, Session>({
      id: 'session.setSections',
      description: 'File a session under one or more sections',
      handler: async (input) => {
        const params = input as { id?: unknown; sectionIds?: unknown } | undefined
        if (!Array.isArray(params?.sectionIds)) {
          throw new Error('session.setSections requires a sectionIds array')
        }
        const sectionIds = params.sectionIds.filter(
          (value): value is string => typeof value === 'string',
        )

        const session = await this.#store.setSessionSections(
          requireId(input, 'session.setSections'),
          sectionIds,
        )
        this.events.emit('session.updated', session)
        return session
      },
    })

    this.commands.register<void, { deleted: string }>({
      id: 'session.delete',
      description: 'Delete a session and its metadata',
      handler: async (input) => {
        const id = requireId(input, 'session.delete')
        await this.#store.deleteSession(id)
        this.events.emit('session.deleted', { id })
        return { deleted: id }
      },
    })

    this.commands.register<void, Section>({
      id: 'section.create',
      description: 'Create a section used to group sessions',
      handler: async (input) => this.#store.createSection(requireName(input, 'section.create')),
    })

    this.commands.register<void, Section>({
      id: 'section.rename',
      description: 'Rename a section',
      handler: async (input) =>
        this.#store.renameSection(
          requireId(input, 'section.rename'),
          requireName(input, 'section.rename'),
        ),
    })

    this.commands.register<void, { removed: string }>({
      id: 'section.remove',
      description: 'Delete a section; sessions stay, they just leave the section',
      handler: async (input) => {
        const id = requireId(input, 'section.remove')
        await this.#store.removeSection(id)
        return { removed: id }
      },
    })
  }
}
