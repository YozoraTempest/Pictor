import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SkillLibrary, renderSkillFile } from './skill-library.js'

const created: string[] = []

function library(): { skills: SkillLibrary; root: string; stash: string; state: string } {
  const base = mkdtempSync(join(tmpdir(), 'pictor-skills-'))
  created.push(base)
  const root = join(base, 'skills')
  const stash = join(base, 'stash')
  const state = join(base, 'state.json')
  return { skills: new SkillLibrary({ root, stash, stateFile: state }), root, stash, state }
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('renderSkillFile', () => {
  it('writes the frontmatter the runtime parses, with the body after it', () => {
    const text = renderSkillFile({
      name: 'release-notes',
      description: '按提交生成发布说明',
      body: '# 步骤\n\n1. 读 git log',
      whenToUse: '当用户要写发布说明时',
    })

    expect(text).toBe(
      [
        '---',
        'name: "release-notes"',
        'description: "按提交生成发布说明"',
        'whenToUse: "当用户要写发布说明时"',
        '---',
        '',
        '# 步骤',
        '',
        '1. 读 git log',
        '',
      ].join('\n'),
    )
  })

  it('writes the negative switches only when a surface is narrowed', () => {
    const open = renderSkillFile({ name: 'a', description: 'd', body: 'b' })
    expect(open).not.toContain('user-invocable')
    expect(open).not.toContain('disable-model-invocation')

    const narrowed = renderSkillFile({
      name: 'a',
      description: 'd',
      body: 'b',
      userInvocable: false,
      modelInvocable: false,
    })
    expect(narrowed).toContain('user-invocable: false')
    expect(narrowed).toContain('disable-model-invocation: true')
  })

  it('quotes a description, so a colon stays part of the text', () => {
    const text = renderSkillFile({ name: 'a', description: '用法：先读后写', body: 'b' })
    expect(text).toContain('description: "用法：先读后写"')
  })
})

describe('SkillLibrary', () => {
  it('materialises a plugin skill and reports it as a plugin row', () => {
    const { skills, root } = library()
    skills.syncPlugin('hello', [{ name: 'greet', description: '打招呼', body: '说你好' }])

    expect(readFileSync(join(root, 'greet', 'SKILL.md'), 'utf8')).toContain('说你好')
    const view = skills.view()
    expect(view.managed.get('greet')).toEqual({ origin: 'plugin', source: 'hello' })
  })

  it('drops the skills a plugin stopped contributing', () => {
    const { skills, root } = library()
    skills.syncPlugin('hello', [
      { name: 'one', description: 'a', body: 'b' },
      { name: 'two', description: 'a', body: 'b' },
    ])

    skills.syncPlugin('hello', [{ name: 'one', description: 'a', body: 'b' }])

    expect(existsSync(join(root, 'one'))).toBe(true)
    expect(existsSync(join(root, 'two'))).toBe(false)
  })

  it('refuses to overwrite a directory Pictor did not write', () => {
    const { skills, root } = library()
    mkdirSync(join(root, 'taken'), { recursive: true })
    writeFileSync(join(root, 'taken', 'SKILL.md'), 'mine')

    skills.syncPlugin('hello', [{ name: 'taken', description: 'a', body: 'b' }])

    expect(readFileSync(join(root, 'taken', 'SKILL.md'), 'utf8')).toBe('mine')
    expect(skills.view().managed.has('taken')).toBe(false)
  })

  it('switches a managed skill off by moving it out of the scanned root', () => {
    const { skills, root, stash } = library()
    skills.syncPlugin('hello', [{ name: 'greet', description: '打招呼', body: '说你好' }])

    skills.setEnabled('greet', false, {
      name: 'greet',
      description: '打招呼',
      whenToUse: null,
      path: join(root, 'greet', 'SKILL.md'),
      origin: 'plugin',
    })

    expect(existsSync(join(root, 'greet'))).toBe(false)
    expect(existsSync(join(stash, 'greet', 'SKILL.md'))).toBe(true)
    const view = skills.view()
    expect(view.managed.has('greet')).toBe(false)
    expect(view.stashed).toEqual([
      { name: 'greet', description: '打招呼', whenToUse: null, source: 'hello' },
    ])
  })

  it('keeps a switched-off plugin skill off when the plugin syncs again', () => {
    const { skills, root, stash } = library()
    skills.syncPlugin('hello', [{ name: 'greet', description: '打招呼', body: '第一版' }])
    skills.setEnabled('greet', false, {
      name: 'greet',
      description: '打招呼',
      whenToUse: null,
      path: null,
      origin: 'plugin',
    })

    skills.syncPlugin('hello', [{ name: 'greet', description: '打招呼', body: '第二版' }])

    expect(existsSync(join(root, 'greet'))).toBe(false)
    expect(readFileSync(join(stash, 'greet', 'SKILL.md'), 'utf8')).toContain('第二版')
  })

  it('switches a managed skill back on', () => {
    const { skills, root } = library()
    skills.syncPlugin('hello', [{ name: 'greet', description: '打招呼', body: '说你好' }])
    const snapshot = {
      name: 'greet',
      description: '打招呼',
      whenToUse: null,
      path: null,
      origin: 'plugin' as const,
    }

    skills.setEnabled('greet', false, snapshot)
    skills.setEnabled('greet', true, snapshot)

    expect(existsSync(join(root, 'greet', 'SKILL.md'))).toBe(true)
    expect(skills.view().stashed).toEqual([])
  })

  it('hides an external skill with a placeholder and restores it', () => {
    const { skills, root } = library()
    const snapshot = {
      name: 'find-skills',
      description: '找技能',
      whenToUse: null,
      path: '/home/someone/.agents/skills/find-skills/SKILL.md',
      origin: 'filesystem' as const,
    }

    skills.setEnabled('find-skills', false, snapshot)

    const placeholder = readFileSync(join(root, 'find-skills', 'SKILL.md'), 'utf8')
    expect(placeholder).toContain('user-invocable: false')
    expect(placeholder).toContain('disable-model-invocation: true')
    expect(skills.view().disabled).toEqual([snapshot])

    skills.setEnabled('find-skills', true, snapshot)
    expect(existsSync(join(root, 'find-skills'))).toBe(false)
    expect(skills.view().disabled).toEqual([])
  })

  it('refuses to switch off a project skill, which outranks its own root', () => {
    const { skills } = library()

    expect(() =>
      skills.setEnabled('in-repo', false, {
        name: 'in-repo',
        description: 'd',
        whenToUse: null,
        path: '/repo/.agents/skills/in-repo/SKILL.md',
        origin: 'project',
      }),
    ).toThrow(/项目/)
  })

  it('refuses to shadow a directory Pictor did not write', () => {
    const { skills, root } = library()
    mkdirSync(join(root, 'theirs'), { recursive: true })
    writeFileSync(join(root, 'theirs', 'SKILL.md'), 'mine')

    expect(() =>
      skills.setEnabled('theirs', false, {
        name: 'theirs',
        description: 'd',
        whenToUse: null,
        path: '/elsewhere/SKILL.md',
        origin: 'filesystem',
      }),
    ).toThrow(/拒绝覆盖/)
    expect(readFileSync(join(root, 'theirs', 'SKILL.md'), 'utf8')).toBe('mine')
  })

  it('survives a corrupted state file by starting empty', () => {
    const { skills, state } = library()
    mkdirSync(join(state, '..'), { recursive: true })
    writeFileSync(state, '{ not json')

    expect(skills.view().disabled).toEqual([])
  })
})
