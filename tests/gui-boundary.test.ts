// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const guiRoot = resolve('src/gui')

describe('GUI Host dependency boundary', () => {
  it('keeps the GUI Host free of Electron, Node, and terminal execution dependencies', async () => {
    const files = (await readdir(guiRoot, { recursive: true })).filter((file) =>
      /\.(?:ts|tsx)$/.test(file),
    )
    const sources = await Promise.all(
      files.map(async (file) => ({ file, source: await readFile(join(guiRoot, file), 'utf8') })),
    )

    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/(?:^|["'])electron(?:["']|$)/m)
      expect(source, file).not.toMatch(
        /(?:from ['"]node:|child_process|globalThis\.process|\bxterm\b|\bpty\b|\bbash\b|\bpowershell\b)/i,
      )
      expect(source, file).not.toMatch(/from ['"](?:\.\.\/)+(?:main|preload|renderer)\//)
      expect(source, file).not.toMatch(/from ['"].*\/(?:plugin-manager|plugin-store|registry)\./i)
    }
  })
})
