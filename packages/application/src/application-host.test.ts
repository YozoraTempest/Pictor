import { describe, expect, it, vi } from 'vitest'

import type { JsonValue, Project, Section, Session, SettingsMap } from '@pictor/shared'

import { ApplicationHost } from './application-host.js'
import type { ApplicationStore } from './application-host.js'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    path: '/tmp/demo',
    name: 'Demo',
    folders: [],
    sectionId: null,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    projectId: 'p1',
    title: 'Draft',
    piSessionId: null,
    pinned: false,
    archived: false,
    sectionIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

class FakeStore implements ApplicationStore {
  projects: Project[] = []
  sessions: Session[] = []
  sections: Section[] = []
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

  async setProjectSection(id: string, sectionId: string | null): Promise<Project> {
    const target = this.projects.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`project ${id}`)
    target.sectionId = sectionId
    return target
  }

  async reorderSections(ids: string[]): Promise<Section[]> {
    this.sections = this.sections.map((entry) => {
      const index = ids.indexOf(entry.id)
      return index === -1 ? entry : { ...entry, position: index }
    })
    return this.sections
  }

  async addProjectFolder(id: string, path: string): Promise<string[]> {
    const target = this.projects.find((entry) => entry.id === id)
    if (target !== undefined) target.folders = [...target.folders, path]
    return target?.folders ?? []
  }

  async removeProjectFolder(id: string, path: string): Promise<string[]> {
    const target = this.projects.find((entry) => entry.id === id)
    if (target !== undefined) target.folders = target.folders.filter((entry) => entry !== path)
    return target?.folders ?? []
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions
  }

  async createSession(projectId: string | null, title: string): Promise<Session> {
    const created = session({ projectId, title })
    this.sessions.push(created)
    return created
  }

  async setSessionArchived(id: string, archived: boolean): Promise<Session> {
    const target = this.sessions.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`session ${id}`)
    target.archived = archived
    return target
  }

  async archiveSessions(ids: string[]): Promise<number> {
    let count = 0
    for (const id of ids) {
      const target = this.sessions.find((entry) => entry.id === id)
      if (target === undefined) continue
      target.archived = true
      count += 1
    }
    return count
  }

  async setSessionPinned(id: string, pinned: boolean): Promise<Session> {
    const target = this.sessions.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`session ${id}`)
    target.pinned = pinned
    return target
  }

  async setSessionProject(id: string, projectId: string | null): Promise<Session> {
    const target = this.sessions.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`session ${id}`)
    target.projectId = projectId
    return target
  }

  async setSessionSections(id: string, sectionIds: string[]): Promise<Session> {
    const target = this.sessions.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`session ${id}`)
    target.sectionIds = sectionIds
    return target
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions = this.sessions.filter((entry) => entry.id !== id)
  }

  async listSections(): Promise<Section[]> {
    return this.sections
  }

  async createSection(name: string): Promise<Section> {
    const created: Section = { id: `sec-${name}`, name, position: 0, createdAt: 1 }
    this.sections.push(created)
    return created
  }

  async renameSection(id: string, name: string): Promise<Section> {
    const target = this.sections.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`section ${id}`)
    target.name = name
    return target
  }

  async removeSection(id: string): Promise<void> {
    this.sections = this.sections.filter((entry) => entry.id !== id)
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
      'project.addFolder',
      'project.remove',
      'project.removeFolder',
      'project.setSection',
      'section.create',
      'section.remove',
      'section.rename',
      'section.reorder',
      'session.archiveMany',
      'session.create',
      'session.delete',
      'session.setArchived',
      'session.setPinned',
      'session.setProject',
      'session.setSections',
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
      /requires a title/,
    )
  })

  it('creates a session without a project', async () => {
    const store = new FakeStore()
    const host = new ApplicationHost(store)

    const created = await host.commands.execute<Session>('session.create', { title: 'Loose' })

    expect(created.projectId).toBeNull()
    expect(store.sessions).toHaveLength(1)
  })

  it('pins a session and emits session.updated', async () => {
    const store = new FakeStore()
    store.sessions = [session()]
    const host = new ApplicationHost(store)
    const listener = vi.fn()
    host.events.on('session.updated', listener)

    const updated = await host.commands.execute<Session>('session.setPinned', {
      id: 's1',
      pinned: true,
    })

    expect(updated.pinned).toBe(true)
    expect(listener).toHaveBeenCalledWith(updated)
  })

  it('files a session under sections', async () => {
    const store = new FakeStore()
    store.sessions = [session()]
    const host = new ApplicationHost(store)

    const updated = await host.commands.execute<Session>('session.setSections', {
      id: 's1',
      sectionIds: ['sec-a', 'sec-b'],
    })

    expect(updated.sectionIds).toEqual(['sec-a', 'sec-b'])
  })

  it('creates a section through the command engine', async () => {
    const host = new ApplicationHost(new FakeStore())

    const created = await host.commands.execute<Section>('section.create', { name: 'Design' })

    expect(created.name).toBe('Design')
    await expect(host.commands.execute('section.create', { name: '  ' })).rejects.toThrow(
      /non-empty name/,
    )
  })

  it('builds a snapshot from the store', async () => {
    const store = new FakeStore()
    store.projects = [project()]
    const host = new ApplicationHost(store)

    await expect(host.snapshot()).resolves.toEqual({
      projects: [project()],
      sessions: [],
      sections: [],
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
