import { describe, expect, it } from 'vitest'

import type { CatalogSkill } from '@pictor/shared'

import { matchSkills, slashTokenAt } from './slash.js'

function skill(name: string, description = ''): CatalogSkill {
  return { name, description, whenToUse: null, path: null, modelInvocable: true }
}

describe('slashTokenAt', () => {
  it('opens at the start of a line and reads the query', () => {
    const token = slashTokenAt('/gri', 4)

    expect(token).toEqual({ start: 0, end: 4, query: 'gri' })
  })

  it('opens after a space, with the span pointing at the slash', () => {
    const token = slashTokenAt('先看看 /gr', 7)

    expect(token).toEqual({ start: 4, end: 7, query: 'gr' })
  })

  it('leaves a path alone: a slash inside a word is not an invocation', () => {
    expect(slashTokenAt('src/a', 5)).toBeNull()
    expect(slashTokenAt('打开 repo/src', 11)).toBeNull()
  })

  it('closes once the name is finished', () => {
    expect(slashTokenAt('/gri ', 5)).toBeNull()
    expect(slashTokenAt('/gri 后面还有字', 12)).toBeNull()
  })

  it('reads only what sits before the caret', () => {
    // The caret is inside the token, so the rest of the line is not part of it.
    expect(slashTokenAt('/grilling', 3)).toEqual({ start: 0, end: 3, query: 'gr' })
  })
})

describe('matchSkills', () => {
  it('lists the catalog for a bare slash', () => {
    const skills = [skill('a'), skill('b')]

    expect(matchSkills(skills, '')).toEqual(skills)
  })

  it('matches the name case-insensitively', () => {
    expect(matchSkills([skill('grilling'), skill('other')], 'GRILL')).toEqual([skill('grilling')])
  })

  it('matches the description too, for someone who does not know the name', () => {
    const skills = [skill('a', '采访式提问'), skill('b', '写代码')]

    expect(matchSkills(skills, '采访')).toEqual([skill('a', '采访式提问')])
  })

  it('caps the menu so a long catalog stays browsable', () => {
    const skills = Array.from({ length: 20 }, (_, index) => skill(`s${String(index)}`))

    expect(matchSkills(skills, '')).toHaveLength(8)
  })
})
