import { describe, expect, it } from 'vitest'

import { composeSkills, parseSkills } from './skill.js'

describe('parseSkills', () => {
  it('reads the catalog and sorts it by name', () => {
    const skills = parseSkills({
      skills: [
        { name: 'writing', description: '写东西', modelInvocable: true, path: '/a/SKILL.md' },
        {
          name: 'grilling',
          description: '采访式提问',
          modelInvocable: false,
          whenToUse: '当需要压测方案时',
        },
      ],
    })

    expect(skills).toEqual([
      {
        name: 'grilling',
        description: '采访式提问',
        modelInvocable: false,
        whenToUse: '当需要压测方案时',
        path: null,
      },
      {
        name: 'writing',
        description: '写东西',
        modelInvocable: true,
        whenToUse: null,
        path: '/a/SKILL.md',
      },
    ])
  })

  it('keeps the entries that parsed when one is malformed', () => {
    const skills = parseSkills({
      skills: [
        { name: 'good', description: 'ok', modelInvocable: true },
        { name: '', description: 'no name', modelInvocable: true },
        { name: 'no-description', description: 7, modelInvocable: true },
      ],
    })

    expect(skills.map((skill) => skill.name)).toEqual(['good'])
  })

  it('refuses an answer that is not a catalog at all', () => {
    // An empty list would read as "you have no skills"; a shifted contract must
    // say so instead.
    expect(() => parseSkills({})).toThrow(/技能列表/)
    expect(() => parseSkills(null)).toThrow(/技能列表/)
  })

  it('refuses a catalog whose entries all lost their required fields', () => {
    expect(() => parseSkills({ skills: [{ name: 'x' }] })).toThrow(/必要字段/)
  })

  it('accepts an empty catalog, which is a real answer', () => {
    expect(parseSkills({ skills: [] })).toEqual([])
  })
})

describe('composeSkills', () => {
  const catalog = [
    {
      name: 'find-skills',
      description: '找技能',
      whenToUse: null,
      path: '/home/me/.agents/skills/find-skills/SKILL.md',
      modelInvocable: true,
    },
    {
      name: 'greet',
      description: '打招呼',
      whenToUse: null,
      path: '/home/me/.config/pictor/harness/skills/greet/SKILL.md',
      modelInvocable: true,
    },
    {
      name: 'in-repo',
      description: '仓库里的',
      whenToUse: null,
      path: '/repo/.agents/skills/in-repo/SKILL.md',
      modelInvocable: true,
    },
  ]
  const empty = { root: null, managed: new Map(), stashed: [], disabled: [] }

  it('reads where a file came from, so the switch knows what it may do', () => {
    const rows = composeSkills(
      catalog,
      { ...empty, managed: new Map([['greet', { origin: 'plugin' as const, source: 'hello' }]]) },
      '/repo',
    )
    const byName = new Map(rows.map((row) => [row.name, row]))

    expect(byName.get('find-skills')?.origin).toBe('filesystem')
    expect(byName.get('greet')?.origin).toBe('plugin')
    expect(byName.get('greet')?.source).toBe('hello')
    expect(byName.get('in-repo')?.origin).toBe('project')
    expect(rows.every((row) => row.enabled)).toBe(true)
  })

  it('adds back a skill Pictor switched off, which the runtime no longer reports', () => {
    const rows = composeSkills(
      catalog.slice(0, 1),
      {
        ...empty,
        stashed: [{ name: 'greet', description: '打招呼', whenToUse: null, source: 'hello' }],
      },
      '/repo',
    )

    expect(rows.find((row) => row.name === 'greet')).toMatchObject({
      enabled: false,
      origin: 'plugin',
      source: 'hello',
    })
  })

  it('adds back a shadowed external skill from the record taken when it was switched off', () => {
    const rows = composeSkills(
      [],
      {
        ...empty,
        disabled: [
          {
            name: 'find-skills',
            description: '找技能',
            whenToUse: null,
            path: '/home/me/.agents/skills/find-skills/SKILL.md',
            origin: 'filesystem' as const,
          },
        ],
      },
      null,
    )

    expect(rows).toEqual([
      {
        name: 'find-skills',
        description: '找技能',
        whenToUse: null,
        path: '/home/me/.agents/skills/find-skills/SKILL.md',
        modelInvocable: true,
        origin: 'filesystem',
        enabled: false,
        source: null,
      },
    ])
  })

  it('lets the live catalog win over a stale record', () => {
    const rows = composeSkills(
      catalog.slice(0, 1),
      {
        ...empty,
        disabled: [
          {
            name: 'find-skills',
            description: '旧描述',
            whenToUse: null,
            path: null,
            origin: 'filesystem' as const,
          },
        ],
      },
      null,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ enabled: true, description: '找技能' })
  })
})
