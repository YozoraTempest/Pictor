import { describe, expect, it } from 'vitest'

import { parseSkills } from './skill.js'

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
