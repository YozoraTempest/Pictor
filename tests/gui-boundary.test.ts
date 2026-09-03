// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const guiRoot = resolve('src/gui')
const delegateRoot = resolve('plugins/workbench-delegate')
const workspaceRoot = resolve('src/modules/agent-workspace')
const pluginsRoot = resolve('plugins')

async function sourceFiles(root: string): Promise<Array<{ file: string; source: string }>> {
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    /\.(?:ts|tsx)$/.test(file),
  )
  return Promise.all(
    files.map(async (file) => ({ file, source: await readFile(join(root, file), 'utf8') })),
  )
}

describe('GUI Host dependency boundary', () => {
  it('keeps the GUI Host free of Electron, Node, and terminal execution dependencies', async () => {
    const sources = await sourceFiles(guiRoot)

    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/(?:^|["'])electron(?:["']|$)/m)
      expect(source, file).not.toMatch(
        /(?:from ['"]node:|child_process|globalThis\.process|\bxterm\b|\bpty\b|\bbash\b|\bpowershell\b)/i,
      )
      expect(source, file).not.toMatch(/from ['"](?:\.\.\/)+(?:main|preload|renderer)\//)
      expect(source, file).not.toMatch(/from ['"].*\/(?:plugin-manager|plugin-store|registry)\./i)
    }
  })

  it('keeps Delegate Workbench GUI-only and independent from Core GUI internals', async () => {
    const sources = await sourceFiles(delegateRoot)
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/(?:from|import) ['"]electron['"]/)
      expect(source, file).not.toMatch(/from ['"]node:/)
      expect(source, file).not.toMatch(/from ['"][^'"]*src\/renderer(?:\/|['"])/)
      expect(source, file).not.toMatch(/\b(?:globalThis\.)?process(?:\.|\[)/)
    }
  })

  it('keeps Agent Workspace free of React, DOM, and product GUI code', async () => {
    const sources = await sourceFiles(workspaceRoot)
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/(?:from|import) ['"](?:react|react-dom)(?:['"]|\/)/)
      expect(source, file).not.toMatch(/\b(?:document|window|className|React\.JSX)\b/)
    }
  })

  it('keeps every bundled Host entry independent from Electron and GUI code', async () => {
    const sources = await Promise.all(
      (await readdir(pluginsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const file = join(pluginsRoot, entry.name, 'host.ts')
          const source = await readFile(file, 'utf8').catch(() => null)
          return source === null ? null : { file, source }
        }),
    )
    for (const value of sources) {
      if (!value) continue
      expect(value.source, value.file).not.toMatch(/(?:from|import) ['"]electron['"]/)
      expect(value.source, value.file).not.toMatch(/from ['"]node:.*electron/i)
      expect(value.source, value.file).not.toMatch(/from ['"][^'"]*src\/renderer(?:\/|['"])/)
    }
  })
})
