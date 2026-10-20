import type { JsonValue, Project, Session, SettingsMap } from '@pictor/shared'

import { CommandEngine } from './command-engine.js'
import { EventBus } from './events.js'

export interface ApplicationStore {
  listProjects(): Promise<Project[]>
  addProject(path: string, name?: string): Promise<Project>
  removeProject(id: string): Promise<void>
  listSessions(projectId?: string): Promise<Session[]>
  createSession(projectId: string, title: string): Promise<Session>
  deleteSession(id: string): Promise<void>
  listSettings(): Promise<SettingsMap>
  putSetting(key: string, value: JsonValue): Promise<void>
}

export interface ApplicationEvents {
  'project.added': Project
  'project.removed': { id: string }
  'session.created': Session
  'session.deleted': { id: string }
}

export interface ApplicationSnapshot {
  projects: Project[]
  sessions: Session[]
  settings: SettingsMap
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
    const [projects, sessions, settings] = await Promise.all([
      this.#store.listProjects(),
      this.#store.listSessions(),
      this.#store.listSettings(),
    ])

    return { projects, sessions, settings }
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
        const params = input as { id?: unknown } | undefined
        if (typeof params?.id !== 'string') {
          throw new Error('project.remove requires an id')
        }

        await this.#store.removeProject(params.id)
        this.events.emit('project.removed', { id: params.id })
        return { removed: params.id }
      },
    })

    this.commands.register<void, Session>({
      id: 'session.create',
      description: 'Create a session inside a project',
      handler: async (input) => {
        const params = input as { projectId?: unknown; title?: unknown } | undefined
        if (typeof params?.projectId !== 'string' || typeof params.title !== 'string') {
          throw new Error('session.create requires projectId and title')
        }

        const session = await this.#store.createSession(params.projectId, params.title)
        this.events.emit('session.created', session)
        return session
      },
    })

    this.commands.register<void, { deleted: string }>({
      id: 'session.delete',
      description: 'Delete a session and its metadata',
      handler: async (input) => {
        const params = input as { id?: unknown } | undefined
        if (typeof params?.id !== 'string') {
          throw new Error('session.delete requires an id')
        }

        await this.#store.deleteSession(params.id)
        this.events.emit('session.deleted', { id: params.id })
        return { deleted: params.id }
      },
    })
  }
}
