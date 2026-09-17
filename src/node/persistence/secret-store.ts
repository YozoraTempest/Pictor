import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { readJsonFile, writeJsonFile } from './atomic-json.js'

const authSchema = z.object({
  apiKey: z.string().min(1).nullable(),
})

const secretsSchema = z.object({
  schemaVersion: z.literal(1),
  apiKeyCiphertext: z.string().min(1).nullable(),
})

interface LegacySafeStorageAdapter {
  isEncryptionAvailable: () => boolean
  decryptString: (encrypted: Buffer) => string
}

export class SecretStore {
  private readonly authPath: string
  private readonly legacyPath: string
  private migration: Promise<void> | null = null

  constructor(
    dataDirectory: string,
    private readonly legacySafeStorage?: LegacySafeStorageAdapter,
  ) {
    this.authPath = join(dataDirectory, 'auth.json')
    this.legacyPath = join(dataDirectory, 'secrets.json')
  }

  async hasApiKey(): Promise<boolean> {
    return (await this.read()).apiKey !== null
  }

  async getApiKey(): Promise<string | null> {
    return (await this.read()).apiKey
  }

  async setApiKey(apiKey: string): Promise<void> {
    await writeJsonFile(this.authPath, { apiKey }, 0o600)
    await this.removeLegacyFile()
  }

  async clearApiKey(): Promise<void> {
    await writeJsonFile(this.authPath, { apiKey: null }, 0o600)
    await this.removeLegacyFile()
  }

  private async read(): Promise<z.infer<typeof authSchema>> {
    await this.ensureMigrated()
    try {
      return (await readJsonFile(this.authPath, authSchema)) ?? { apiKey: null }
    } catch {
      return { apiKey: null }
    }
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migration) this.migration = this.migrateLegacyFile()
    await this.migration
  }

  private async migrateLegacyFile(): Promise<void> {
    try {
      const auth = await readJsonFile(this.authPath, authSchema)
      if (auth) {
        await this.removeLegacyFile()
        return
      }
    } catch {
      return
    }

    let legacy: z.infer<typeof secretsSchema> | null
    try {
      legacy = await readJsonFile(this.legacyPath, secretsSchema)
    } catch {
      return
    }
    if (!legacy) return

    let apiKey: string | null = null
    if (legacy.apiKeyCiphertext !== null) {
      if (!this.legacySafeStorage?.isEncryptionAvailable()) return
      try {
        apiKey = this.legacySafeStorage.decryptString(
          Buffer.from(legacy.apiKeyCiphertext, 'base64'),
        )
      } catch {
        return
      }
    }

    await writeJsonFile(this.authPath, { apiKey }, 0o600)
    await this.removeLegacyFile()
  }

  private async removeLegacyFile(): Promise<void> {
    await unlink(this.legacyPath).catch(() => undefined)
  }
}
