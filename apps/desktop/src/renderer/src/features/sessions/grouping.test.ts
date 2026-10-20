import { describe, expect, it } from 'vitest'

import type { Project, Section, Session } from '@pictor/shared'

import { groupSessions } from './grouping.js'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const DAY = 86_400_000

function project(id: string, name: string): Project {
  return { id, path: `/tmp/${id}`, name, folders: [], createdAt: 0, updatedAt: 0 }
}

function section(id: string, name: string, position: number): Section {
  return { id, name, position, createdAt: 0 }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    projectId: null,
    title: 'Chat',
    piSessionId: null,
    pinned: false,
    sectionIds: [],
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

const projects = [project('p1', 'Alpha'), project('p2', 'Beta')]
const sections = [section('sec1', 'Design', 0), section('sec2', 'Research', 1)]

describe('groupSessions', () => {
  describe('project grouping', () => {
    it('groups by project and keeps an unfiled bucket', () => {
      const groups = groupSessions({
        sessions: [
          session({ id: 'a', projectId: 'p1' }),
          session({ id: 'b', projectId: 'p2' }),
          session({ id: 'c', projectId: null }),
        ],
        projects,
        sections,
        grouping: 'project',
        exclusive: true,
      })

      expect(groups.map((group) => [group.title, group.sessions.length])).toEqual([
        ['Alpha', 1],
        ['Beta', 1],
        ['未归属项目', 1],
      ])
    })

    it('hides projects without sessions', () => {
      const groups = groupSessions({
        sessions: [session({ projectId: 'p2' })],
        projects,
        sections,
        grouping: 'project',
        exclusive: true,
      })

      expect(groups.map((group) => group.title)).toEqual(['Beta'])
    })
  })

  describe('section grouping', () => {
    it('lists a session under every section when not exclusive', () => {
      const groups = groupSessions({
        sessions: [session({ id: 'a', sectionIds: ['sec1', 'sec2'] })],
        projects,
        sections,
        grouping: 'section',
        exclusive: false,
      })

      expect(groups.map((group) => group.title)).toEqual(['Design', 'Research'])
      expect(groups.every((group) => group.sessions.length === 1)).toBe(true)
    })

    it('keeps only the first section when exclusive', () => {
      const groups = groupSessions({
        sessions: [session({ id: 'a', sectionIds: ['sec2', 'sec1'] })],
        projects,
        sections,
        grouping: 'section',
        exclusive: true,
      })

      expect(groups.map((group) => group.title)).toEqual(['Design'])
    })

    it('collects sessions without sections into one bucket', () => {
      const groups = groupSessions({
        sessions: [session({ id: 'a' }), session({ id: 'b', sectionIds: ['sec1'] })],
        projects,
        sections,
        grouping: 'section',
        exclusive: true,
      })

      expect(groups.map((group) => [group.title, group.sessions.map((entry) => entry.id)])).toEqual(
        [
          ['Design', ['b']],
          ['未归档', ['a']],
        ],
      )
    })
  })

  describe('recent grouping', () => {
    it('buckets by age', () => {
      const groups = groupSessions({
        sessions: [
          session({ id: 'today', updatedAt: NOW - HOUR }),
          session({ id: 'yesterday', updatedAt: NOW - DAY - HOUR }),
          session({ id: 'week', updatedAt: NOW - 3 * DAY }),
          session({ id: 'older', updatedAt: NOW - 30 * DAY }),
        ],
        projects,
        sections,
        grouping: 'recent',
        exclusive: true,
        now: NOW,
      })

      expect(groups.map((group) => group.title)).toEqual(['今天', '昨天', '最近 7 天', '更早'])
    })
  })

  describe('pinned', () => {
    it('puts pinned sessions in their own group first', () => {
      const groups = groupSessions({
        sessions: [
          session({ id: 'pinned', pinned: true, projectId: 'p1' }),
          session({ id: 'plain', projectId: 'p1' }),
        ],
        projects,
        sections,
        grouping: 'project',
        exclusive: true,
      })

      expect(groups[0]?.title).toBe('置顶')
      expect(groups[0]?.sessions.map((entry) => entry.id)).toEqual(['pinned'])

      const alpha = groups.find((group) => group.title === 'Alpha')
      expect(alpha?.sessions.map((entry) => entry.id)).toEqual(['plain'])
    })

    it('also lists pinned sessions in their group when not exclusive', () => {
      const groups = groupSessions({
        sessions: [session({ id: 'pinned', pinned: true, projectId: 'p1' })],
        projects,
        sections,
        grouping: 'project',
        exclusive: false,
      })

      expect(groups.map((group) => group.title)).toEqual(['置顶', 'Alpha'])
    })
  })

  it('orders sessions inside a group by recency, pinned first', () => {
    const groups = groupSessions({
      sessions: [
        session({ id: 'old', updatedAt: NOW - 3 * HOUR }),
        session({ id: 'new', updatedAt: NOW - HOUR }),
        session({ id: 'pinned', pinned: true, updatedAt: NOW - 5 * DAY }),
      ],
      projects,
      sections,
      grouping: 'recent',
      exclusive: false,
      now: NOW,
    })

    expect(groups[0]?.sessions.map((entry) => entry.id)).toEqual(['pinned'])
    expect(groups[1]?.sessions.map((entry) => entry.id)).toEqual(['new', 'old'])
  })

  it('returns no groups for an empty list', () => {
    expect(
      groupSessions({ sessions: [], projects, sections, grouping: 'project', exclusive: true }),
    ).toEqual([])
  })
})
