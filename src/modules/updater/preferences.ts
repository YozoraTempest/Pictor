import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { updateChannelSchema, type UpdateChannel } from './shared.js'

const preferencesSchema = z.object({
  schemaVersion: z.literal(1),
  channel: updateChannelSchema,
})

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export class UpdatePreferences {
  private readonly path: string

  constructor(dataPath: string) {
    this.path = join(dataPath, 'preferences.json')
  }

  async getChannel(): Promise<UpdateChannel> {
    let source: string
    try {
      source = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return 'stable'
      throw error
    }
    return preferencesSchema.parse(JSON.parse(source)).channel
  }

  async setChannel(channel: UpdateChannel): Promise<void> {
    const preferences = preferencesSchema.parse({ schemaVersion: 1, channel })
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    await mkdir(dirname(this.path), { recursive: true })
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      await rename(temporaryPath, this.path)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}
