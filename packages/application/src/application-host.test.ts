import { describe, expect, it, vi } from 'vitest'

import type { JsonValue, Project, Session, SettingsMap } from '@pictor/shared'

import { ApplicationHost } from './application-host.js'
import type { ApplicationStore } from './application-host.js'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    path: '/tmp/demo',
    name: 'Demo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

class FakeStore implements ApplicationStore {
  projects: Project[] = []
  sessions: Session[] = []
  settings: SettingsMap = {}

  async listProjects(): Promise<Project[]> {
    return this.projects
  }

  async addProject(path: string, name?: string): Promise<Project> {
    const created = project({ path, name: name ?? 'Demo' })
    this.projects.push(created)
    return created
  }

  async removeProject(id: string): Promise<void> {
    this.projects = this.projects.filter((entry) => entry.id !== id)
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions
  }

  async createSession(projectId: string, title: string): Promise<Session> {
    const session: Session = {
      id: 's1',
      projectId,
      title,
      piSessionId: null,
      createdAt: 1,
      updatedAt: 1,
    }
    this.sessions.push(session)
    return session
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions = this.sessions.filter((session) => session.id !== id)
  }

  async listSettings(): Promise<SettingsMap> {
    return this.settings
  }

  async putSetting(_key: string, _value: JsonValue): Promise<void> {}
}

describe('ApplicationHost', () => {
  it('registers the core commands', () => {
    const host = new ApplicationHost(new FakeStore())

    expect(host.commands.list().map((command) => command.id)).toEqual([
      'project.add',
      'project.remove',
      'session.create',
      'session.delete',
    ])
  })

  it('adds a project and emits an event', async () => {
    const store = new FakeStore()
    const host = new ApplicationHost(store)
    const listener = vi.fn()
    host.events.on('project.added', listener)

    const created = await host.commands.execute<Project>('project.add', {
      path: '/tmp/demo',
      name: 'Demo',
    })

    expect(created.path).toBe('/tmp/demo')
    expect(listener).toHaveBeenCalledWith(created)
  })

  it('rejects invalid command input', async () => {
    const host = new ApplicationHost(new FakeStore())

    await expect(host.commands.execute('project.add', {})).rejects.toThrow(/non-empty path/)
    await expect(host.commands.execute('session.create', { projectId: 'p1' })).rejects.toThrow(
      /projectId and title/,
    )
  })

  it('builds a snapshot from the store', async () => {
    const store = new FakeStore()
    store.projects = [project()]
    const host = new ApplicationHost(store)

    await expect(host.snapshot()).resolves.toEqual({
      projects: [project()],
      sessions: [],
      settings: {},
    })
  })

  it('isolates a throwing listener', async () => {
    const host = new ApplicationHost(new FakeStore())
    const healthy = vi.fn()

    host.events.on('project.added', () => {
      throw new Error('listener failed')
    })
    host.events.on('project.added', healthy)

    await host.commands.execute('project.add', { path: '/tmp/demo' })

    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
