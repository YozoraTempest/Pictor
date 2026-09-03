// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const delegateRoot = resolve('plugins/workbench-delegate')
const pluginsRoot = resolve('plugins')

async function sourceFiles(root: string): Promise<Array<{ file: string; source: string }>> {
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    /\.(?:ts|tsx)$/.test(file),
  )
  return Promise.all(
    files.map(async (file) => ({ file, source: await readFile(join(root, file), 'utf8') })),
  )
}

describe('Bundled Plugin source boundaries', () => {
  it('keeps Delegate Workbench GUI-only and independent from Core GUI internals', async () => {
    const sources = await sourceFiles(delegateRoot)
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/(?:from|import) ['"]electron['"]/)
      expect(source, file).not.toMatch(/from ['"]node:/)
      expect(source, file).not.toMatch(/from ['"][^'"]*src\/renderer(?:\/|['"])/)
      expect(source, file).not.toMatch(/\b(?:globalThis\.)?process(?:\.|\[)/)
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
