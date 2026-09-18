import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { z } from 'zod'

export async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const content = await readFile(path, 'utf8')
    return schema.parse(JSON.parse(content))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

export async function writeJsonFile(path: string, value: unknown, mode?: number): Promise<void> {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, mode)
}

export async function writeTextFile(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', mode)

  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporaryPath, path)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
