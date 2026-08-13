// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

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
    expect(guard.toRelative(await guard.resolveForWrite('nested/new.txt'))).toBe(
      relative(projectRoot, join(projectRoot, 'nested', 'new.txt')),
    )
  })

  it.runIf(process.platform !== 'win32')(
    'allows legal Linux filenames that resemble traversal or drive syntax',
    async () => {
      await writeFile(join(projectRoot, '..notes'), 'notes')
      await writeFile(join(projectRoot, 'chapter:one.txt'), 'chapter')
      const guard = await ProjectPathGuard.create(projectRoot)

      await expect(guard.resolveExisting('..notes')).resolves.toBe(join(projectRoot, '..notes'))
      await expect(guard.resolveExisting('chapter:one.txt')).resolves.toBe(
        join(projectRoot, 'chapter:one.txt'),
      )
    },
  )

  it('rejects parent traversal outside the project root', async () => {
    const guard = await ProjectPathGuard.create(projectRoot)
    await expect(guard.resolveExisting('../outside/secret.txt')).rejects.toThrow(
      '拒绝访问项目外路径',
    )
  })

  it('rejects a directory link that resolves outside the project root', async () => {
    await symlink(outsideRoot, join(projectRoot, 'escape'), 'junction')
    const guard = await ProjectPathGuard.create(projectRoot)
    await expect(guard.resolveExisting('escape/secret.txt')).rejects.toThrow('拒绝访问项目外路径')
    await expect(guard.resolveForWrite('escape/new.txt')).rejects.toThrow('拒绝访问项目外路径')
  })

  it.runIf(process.platform !== 'win32')(
    'rejects an absolute path in a differently-cased sibling directory',
    async () => {
      const caseSensitiveProject = join(testRoot, 'Repo')
      const caseSensitiveSibling = join(testRoot, 'repo')
      await mkdir(caseSensitiveProject)
      await mkdir(caseSensitiveSibling)
      await writeFile(join(caseSensitiveSibling, 'secret.txt'), 'outside')

      const guard = await ProjectPathGuard.create(caseSensitiveProject)
      await expect(guard.resolveExisting(join(caseSensitiveSibling, 'secret.txt'))).rejects.toThrow(
        '拒绝访问项目外路径',
      )
    },
  )
})
