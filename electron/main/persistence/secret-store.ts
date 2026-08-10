import { join } from 'node:path'

import { z } from 'zod'

import { readJsonFile, writeJsonFile } from './atomic-json.js'

const secretsSchema = z.object({
  schemaVersion: z.literal(1),
  apiKeyCiphertext: z.string().min(1).nullable(),
})

interface SafeStorageAdapter {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export class CredentialUnavailableError extends Error {
  constructor() {
    super('Windows 安全凭据存储当前不可用，请重新登录系统后再试')
    this.name = 'CredentialUnavailableError'
  }
}

export class SecretStore {
  private readonly path: string

  constructor(
    dataDirectory: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {
    this.path = join(dataDirectory, 'secrets.json')
  }

  async hasApiKey(): Promise<boolean> {
    const secrets = await this.read()
    return secrets.apiKeyCiphertext !== null
  }

  async getApiKey(): Promise<string | null> {
    const secrets = await this.read()
    if (secrets.apiKeyCiphertext === null) return null
    this.ensureAvailable()
    return this.safeStorage.decryptString(Buffer.from(secrets.apiKeyCiphertext, 'base64'))
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.ensureAvailable()
    const ciphertext = this.safeStorage.encryptString(apiKey).toString('base64')
    await writeJsonFile(this.path, { schemaVersion: 1, apiKeyCiphertext: ciphertext })
  }

  async clearApiKey(): Promise<void> {
    await writeJsonFile(this.path, { schemaVersion: 1, apiKeyCiphertext: null })
  }

  private ensureAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) throw new CredentialUnavailableError()
  }

  private async read(): Promise<z.infer<typeof secretsSchema>> {
    return (
      (await readJsonFile(this.path, secretsSchema)) ?? {
        schemaVersion: 1,
        apiKeyCiphertext: null,
      }
    )
  }
}
