import { describe, expect, it } from 'vitest'

import type { Project, Section, Session } from '@pictor/shared'

import { collectSectionSessionIds, groupSessions } from './grouping.js'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

function project(id: string, name: string): Project {
  return {
    id,
    path: `/tmp/${id}`,
    name,
    folders: [],
    sectionId: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

function section(id: string, name: string, position = 0): Section {
  return { id, name, position, createdAt: 0 }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    projectId: null,
    title: 'Chat',
    piSessionId: null,
    pinned: false,
    archived: false,
    position: 0,
    sectionIds: [],
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

const projects = [project('p1', 'Alpha'), project('p2', 'Beta')]

function titles(nodes: ReturnType<typeof groupSessions>): string[] {
  return nodes.map((node) => node.title)
}

describe('groupSessions (section → project → session)', () => {
  it('always exposes the three built-in sections first', () => {
    const nodes = groupSessions({
      sessions: [],
      projects: [],
      sections: [],
      exclusive: false,
      sorts: {},
    })

    expect(titles(nodes)).toEqual(['置顶', '项目', '最近'])
    expect(nodes.every((node) => node.builtin)).toBe(true)
  })

  it('nests sessions under their project', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'a', projectId: 'p1' }), session({ id: 'b', projectId: 'p2' })],
      projects,
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const projectsSection = nodes.find((node) => node.id === 'projects')
    expect(projectsSection?.children.map((child) => child.kind)).toEqual(['project', 'project'])

    const alpha = projectsSection?.children[0]
    expect(alpha?.kind).toBe('project')
    if (alpha?.kind === 'project') {
      expect(alpha.project.name).toBe('Alpha')
      expect(alpha.sessions.map((entry) => entry.id)).toEqual(['a'])
    }
  })

  it('keeps empty projects so their "+" action stays reachable', () => {
    const nodes = groupSessions({
      sessions: [],
      projects,
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const projectsSection = nodes.find((node) => node.id === 'projects')
    expect(projectsSection?.children).toHaveLength(2)
  })

  it('lists sessions without a project as direct children', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'loose', projectId: null })],
      projects,
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const projectsSection = nodes.find((node) => node.id === 'projects')
    const leaf = projectsSection?.children.find((child) => child.kind === 'session')
    expect(leaf?.kind).toBe('session')
    if (leaf?.kind === 'session') expect(leaf.session.id).toBe('loose')
  })

  it('puts pinned sessions in the pinned section', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'pin', pinned: true, projectId: 'p1' })],
      projects,
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const pinned = nodes.find((node) => node.id === 'pinned')
    expect(pinned?.count).toBe(1)
    expect(pinned?.children[0]?.kind).toBe('session')
  })

  it('drops pinned sessions from other sections when exclusive', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'pin', pinned: true, projectId: 'p1' })],
      projects,
      sections: [],
      exclusive: true,
      sorts: {},
    })

    const projectsSection = nodes.find((node) => node.id === 'projects')
    expect(projectsSection?.count).toBe(0)
  })

  it('keeps archived sessions in their own section only', () => {
    const nodes = groupSessions({
      sessions: [
        session({ id: 'gone', archived: true, sectionIds: ['sec1'] }),
        session({ id: 'live' }),
      ],
      projects: [],
      sections: [section('sec1', 'Design')],
      exclusive: false,
      sorts: {},
    })

    expect(titles(nodes)).toContain('已归档')
    const archived = nodes.find((node) => node.id === 'archived')
    expect(archived?.count).toBe(1)

    const design = nodes.find((node) => node.title === 'Design')
    expect(design?.count).toBe(0)
  })

  it('lists tagged sessions flat inside a custom section', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'tagged', projectId: 'p2', sectionIds: ['sec1'] })],
      projects,
      sections: [section('sec1', 'Design')],
      exclusive: false,
      sorts: {},
    })

    const design = nodes.find((node) => node.title === 'Design')
    expect(design?.kind).toBe('custom')
    expect(design?.sectionId).toBe('sec1')
    expect(design?.children[0]?.kind).toBe('session')
  })

  it('nests a project only in the section it is filed under', () => {
    const filed = [project('p1', 'Alpha'), { ...project('p2', 'Beta'), sectionId: 'sec1' }]
    const nodes = groupSessions({
      sessions: [session({ id: 'a', projectId: 'p1' }), session({ id: 'b', projectId: 'p2' })],
      projects: filed,
      sections: [section('sec1', 'Design')],
      exclusive: false,
      sorts: {},
    })

    const design = nodes.find((node) => node.title === 'Design')
    expect(design?.children).toHaveLength(1)
    expect(design?.children[0]?.kind).toBe('project')
    if (design?.children[0]?.kind === 'project') {
      expect(design.children[0].project.id).toBe('p2')
      expect(design.children[0].sessions.map((entry) => entry.id)).toEqual(['b'])
    }

    const projectsSection = nodes.find((node) => node.id === 'projects')
    // p2 is filed under Design, so its session shows up as a loose leaf here.
    expect(projectsSection?.children.map((child) => child.kind)).toEqual(['project', 'session'])
  })

  it('keeps the recent section flat', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'a', projectId: 'p1' })],
      projects,
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const recent = nodes.find((node) => node.id === 'recent')
    expect(recent?.children.every((child) => child.kind === 'session')).toBe(true)
  })

  it('orders by creation time when asked', () => {
    const nodes = groupSessions({
      sessions: [
        session({ id: 'older', createdAt: NOW - 10 * HOUR, updatedAt: NOW }),
        session({ id: 'newer', createdAt: NOW - HOUR, updatedAt: NOW - 5 * HOUR }),
      ],
      projects: [],
      sections: [],
      exclusive: false,
      sorts: { recent: 'created' },
    })

    const recent = nodes.find((node) => node.id === 'recent')
    const ids = recent?.children.map((child) => (child.kind === 'session' ? child.session.id : ''))
    expect(ids).toEqual(['newer', 'older'])
  })

  it('defaults to ordering by last activity', () => {
    const nodes = groupSessions({
      sessions: [
        session({ id: 'stale', createdAt: NOW - HOUR, updatedAt: NOW - 10 * HOUR }),
        session({ id: 'fresh', createdAt: NOW - 10 * HOUR, updatedAt: NOW }),
      ],
      projects: [],
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const recent = nodes.find((node) => node.id === 'recent')
    const ids = recent?.children.map((child) => (child.kind === 'session' ? child.session.id : ''))
    expect(ids).toEqual(['fresh', 'stale'])
  })

  it('honours the manual order when a section is sorted by hand', () => {
    const nodes = groupSessions({
      sessions: [
        session({ id: 'third', position: 2, updatedAt: NOW }),
        session({ id: 'first', position: 0, updatedAt: NOW - 5 * HOUR }),
        session({ id: 'second', position: 1, updatedAt: NOW - 2 * HOUR }),
      ],
      projects: [],
      sections: [],
      exclusive: false,
      sorts: { recent: 'manual' },
    })

    const recent = nodes.find((node) => node.id === 'recent')
    const ids = recent?.children.map((child) => (child.kind === 'session' ? child.session.id : ''))
    expect(ids).toEqual(['first', 'second', 'third'])
  })

  it('collects every session id of a section for archive actions', () => {
    const nodes = groupSessions({
      sessions: [session({ id: 'a', projectId: 'p1' }), session({ id: 'b', projectId: null })],
      projects,
      sections: [],
      exclusive: false,
      sorts: {},
    })

    const projectsSection = nodes.find((node) => node.id === 'projects')
    expect(projectsSection).toBeDefined()
    expect(collectSectionSessionIds(projectsSection!).sort()).toEqual(['a', 'b'])
  })
})
