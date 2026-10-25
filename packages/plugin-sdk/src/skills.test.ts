import { describe, expect, it } from 'vitest'

import { parseSkillContribution, parseSkillContributions } from './skills.js'

describe('parseSkillContribution', () => {
  it('reads the fields a skill needs', () => {
    const skill = parseSkillContribution({
      name: 'release-notes',
      description: '按提交生成发布说明',
      body: '# 步骤\n\n1. 读 git log',
      whenToUse: '当用户要写发布说明时',
    })

    expect(skill).toEqual({
      name: 'release-notes',
      description: '按提交生成发布说明',
      body: '# 步骤\n\n1. 读 git log',
      whenToUse: '当用户要写发布说明时',
    })
  })

  it('leaves the invocation policy alone unless it is narrowed', () => {
    const open = parseSkillContribution({ name: 'a', description: 'd', body: 'b' })
    expect(open.modelInvocable).toBeUndefined()
    expect(open.userInvocable).toBeUndefined()

    const modelOnly = parseSkillContribution({
      name: 'a',
      description: 'd',
      body: 'b',
      userInvocable: false,
    })
    expect(modelOnly.userInvocable).toBe(false)
    expect(modelOnly.modelInvocable).toBeUndefined()
  })

  it('rejects a name the catalogue could not reference', () => {
    expect(() =>
      parseSkillContribution({ name: 'Release Notes', description: 'd', body: 'b' }),
    ).toThrow(/kebab-case/)
    expect(() => parseSkillContribution({ name: '', description: 'd', body: 'b' })).toThrow(
      /required/,
    )
  })

  it('rejects a description that would break the frontmatter it is written into', () => {
    // The description is rendered on one catalogue line and parsed back out of a
    // YAML block, so a newline would corrupt both.
    expect(() =>
      parseSkillContribution({ name: 'a', description: 'first\nsecond', body: 'b' }),
    ).toThrow(/one line/)
    expect(() => parseSkillContribution({ name: 'a', description: '   ', body: 'b' })).toThrow(
      /required/,
    )
  })

  it('rejects an empty body, which would load nothing', () => {
    expect(() => parseSkillContribution({ name: 'a', description: 'd', body: '  ' })).toThrow(
      /body is required/,
    )
  })
})

describe('parseSkillContributions', () => {
  it('keeps the valid skills and reports the rest', () => {
    const { skills, failures } = parseSkillContributions([
      { name: 'good', description: 'd', body: 'b' },
      { name: 'bad name', description: 'd', body: 'b' },
    ])

    expect(skills.map((skill) => skill.name)).toEqual(['good'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.name).toBe('bad name')
  })

  it('lets the first plugin keep a name two of them claim', () => {
    const { skills, failures } = parseSkillContributions([
      { name: 'shared', description: 'first', body: 'b' },
      { name: 'shared', description: 'second', body: 'b' },
    ])

    expect(skills).toEqual([{ name: 'shared', description: 'first', body: 'b' }])
    expect(failures[0]?.reason).toMatch(/duplicate/)
  })
})
