// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProjectPathGuard } from './path-guard.js'

describe('ProjectPathGuard', () => {
  let testRoot: string
  let projectRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'pictor-path-guard-'))
    projectRoot = join(testRoot, 'project')
    outsideRoot = join(testRoot, 'outside')
    await mkdir(projectRoot)
    await mkdir(outsideRoot)
    await writeFile(join(projectRoot, 'inside.txt'), 'inside')
    await writeFile(join(outsideRoot, 'secret.txt'), 'outside')
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('resolves existing and new paths inside the canonical project root', async () => {
    const guard = await ProjectPathGuard.create(projectRoot)
    expect(guard.toRelative(await guard.resolveExisting('inside.txt'))).toBe('inside.txt')
    expect(guard.toRelative(await guard.resolveForWrite('nested/new.txt'))).toBe('nested\\new.txt')
  })

  it('rejects parent traversal outside the project root', async () => {
    const guard = await ProjectPathGuard.create(projectRoot)
    await expect(guard.resolveExisting('../outside/secret.txt')).rejects.toThrow(
      '拒绝访问项目外路径',
    )
  })

  it('rejects a directory junction that resolves outside the project root', async () => {
    await symlink(outsideRoot, join(projectRoot, 'escape'), 'junction')
    const guard = await ProjectPathGuard.create(projectRoot)
    await expect(guard.resolveExisting('escape/secret.txt')).rejects.toThrow('拒绝访问项目外路径')
    await expect(guard.resolveForWrite('escape/new.txt')).rejects.toThrow('拒绝访问项目外路径')
  })
})
