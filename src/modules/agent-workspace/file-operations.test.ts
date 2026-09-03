// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readMessageImages } from './file-operations.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Agent Workspace image file operations', () => {
  it('reads supported images from explicit absolute paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-workspace-images-'))
    roots.push(root)
    const imagePath = join(root, 'preview.png')
    await writeFile(imagePath, Buffer.from('image data'))

    await expect(readMessageImages([imagePath])).resolves.toEqual([
      {
        data: Buffer.from('image data').toString('base64'),
        mimeType: 'image/png',
        name: 'preview.png',
      },
    ])
  })

  it('rejects relative paths and unsupported extensions before reading', async () => {
    const read = vi.fn(async () => Buffer.from('unexpected'))

    await expect(readMessageImages(['preview.png'], read)).rejects.toMatchObject({
      code: 'invalid-input',
    })
    await expect(readMessageImages(['/tmp/preview.bmp'], read)).rejects.toMatchObject({
      code: 'invalid-input',
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('returns a typed persistence error for missing files', async () => {
    await expect(readMessageImages(['/tmp/pictor-missing-image.png'])).rejects.toMatchObject({
      code: 'persistence-failed',
    })
  })

  it('returns a typed persistence error for permission failures', async () => {
    const read = vi.fn(async () => {
      const error = new Error('permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      throw error
    })

    await expect(readMessageImages(['/tmp/protected-image.png'], read)).rejects.toMatchObject({
      code: 'persistence-failed',
      message: '没有权限读取图片文件',
    })
  })
})
