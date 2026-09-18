// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WebFileTransferStore } from './file-transfers.js'

describe('WebFileTransferStore', () => {
  let directory: string
  let store: WebFileTransferStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pictor-web-files-'))
    store = new WebFileTransferStore(join(directory, 'transfers'))
  })

  afterEach(async () => {
    await store.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  it('lists local directories without reading file contents', async () => {
    await writeFile(join(directory, 'session.jsonl'), '{}\n')
    await mkdir(join(directory, 'project'))
    const listing = await store.listDirectory(directory)
    expect(listing.path).toBe(directory)
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'session.jsonl', kind: 'file' }),
        expect.objectContaining({ name: 'project', kind: 'directory' }),
      ]),
    )
  })

  it('creates isolated import and export transfers and releases them', async () => {
    const imported = await store.createImport('history.jsonl', chunks(['one', 'two']))
    await expect(readFile(imported.path, 'utf8')).resolves.toBe('onetwo')

    const exported = await store.reserveExport('html', 'session')
    await writeFile(exported.path, '<main>session</main>')
    await expect(store.claimDownload(exported.ticket)).resolves.toEqual({
      path: exported.path,
      name: 'session.html',
    })
    await expect(store.claimDownload(exported.ticket)).resolves.toBeNull()

    await store.release(imported.ticket)
    await store.completeDownload({ path: exported.path, name: exported.name })
  })

  it('rejects explicit relative directory paths', async () => {
    await expect(store.listDirectory('relative/project')).rejects.toThrow('目录路径必须是绝对路径')
    await expect(store.createDirectory('relative', 'project')).rejects.toThrow(
      '目录路径必须是绝对路径',
    )
  })
})

async function* chunks(values: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield Buffer.from(value)
}
