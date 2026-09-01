import { readFile } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'

import type { ImageAttachment } from '../../shared/domain.js'
import { PictorError } from '../../shared/errors.js'

const imageMimeTypes: Record<string, ImageAttachment['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export type ImageFileReader = (path: string) => Promise<Buffer>

const readImageFile: ImageFileReader = (path) => readFile(path)

export async function readMessageImages(
  paths: readonly string[],
  read: ImageFileReader = readImageFile,
): Promise<ImageAttachment[]> {
  return Promise.all(
    paths.map(async (path) => {
      if (!isAbsolute(path)) {
        throw new PictorError('invalid-input', '图片路径必须是绝对路径')
      }

      const mimeType = imageMimeTypes[extname(path).toLowerCase()]
      if (!mimeType) throw new PictorError('invalid-input', '请选择支持的图片格式')

      try {
        return {
          data: (await read(path)).toString('base64'),
          mimeType,
          name: basename(path),
        }
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        if (code === 'EACCES' || code === 'EPERM') {
          throw new PictorError('persistence-failed', '没有权限读取图片文件')
        }
        throw new PictorError(
          'persistence-failed',
          error instanceof Error ? `无法读取图片文件：${error.message}` : '无法读取图片文件',
        )
      }
    }),
  )
}
