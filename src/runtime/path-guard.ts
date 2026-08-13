import { lstat, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { PictorError } from '../shared/errors.js'

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath) &&
      (process.platform !== 'win32' || !relativePath.includes(':')))
  )
}

export class ProjectPathGuard {
  private constructor(readonly root: string) {}

  static async create(projectRoot: string): Promise<ProjectPathGuard> {
    const canonicalRoot = await realpath(projectRoot)
    const details = await stat(canonicalRoot)
    if (!details.isDirectory()) throw new PictorError('project-unavailable', '项目根路径不是目录')
    return new ProjectPathGuard(canonicalRoot)
  }

  async resolveExisting(input: string): Promise<string> {
    const candidate = this.resolveSyntactic(input)
    let canonical: string
    try {
      canonical = await realpath(candidate)
    } catch {
      throw new PictorError('not-found', `项目内路径不存在：${input}`)
    }
    this.assertWithin(canonical, input)
    return canonical
  }

  async resolveForWrite(input: string): Promise<string> {
    const candidate = this.resolveSyntactic(input)
    let ancestor = candidate

    while (true) {
      try {
        await lstat(ancestor)
        break
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') throw error
        const parent = dirname(ancestor)
        if (parent === ancestor) throw new PictorError('not-found', `无法解析路径：${input}`)
        ancestor = parent
      }
    }

    const canonicalAncestor = await realpath(ancestor)
    this.assertWithin(canonicalAncestor, input)
    const canonicalCandidate = resolve(canonicalAncestor, relative(ancestor, candidate))
    this.assertWithin(canonicalCandidate, input)
    return canonicalCandidate
  }

  toRelative(path: string): string {
    this.assertWithin(path, path)
    return relative(this.root, path) || '.'
  }

  private resolveSyntactic(input: string): string {
    if (!input.trim()) throw new PictorError('invalid-input', '路径不能为空')
    const candidate = isAbsolute(input) ? resolve(input) : resolve(this.root, input)
    this.assertWithin(candidate, input)
    return candidate
  }

  private assertWithin(candidate: string, input: string): void {
    if (!isWithin(this.root, candidate)) {
      throw new PictorError('invalid-input', `拒绝访问项目外路径：${input}`)
    }
  }
}
