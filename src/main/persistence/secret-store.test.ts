// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SecretStore } from './secret-store.js'

describe('SecretStore', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'pictor-auth-'))
    roots.push(root)
    return root
  }

  it('persists the API key in a separate auth file', async () => {
    const root = await createRoot()
    const store = new SecretStore(root)

    await store.setApiKey('secret-value')

    expect(await store.getApiKey()).toBe('secret-value')
    expect(await store.hasApiKey()).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'auth.json'), 'utf8'))).toEqual({
      apiKey: 'secret-value',
    })
    if (process.platform !== 'win32') {
      expect((await stat(join(root, 'auth.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('treats a corrupt auth file as an unconfigured credential and recovers on save', async () => {
    const root = await createRoot()
    await writeFile(join(root, 'auth.json'), '{invalid json')
    const store = new SecretStore(root)

    expect(await store.getApiKey()).toBeNull()
    expect(await store.hasApiKey()).toBe(false)

    await store.setApiKey('replacement')
    expect(await store.getApiKey()).toBe('replacement')
  })

  it('migrates the legacy encrypted credential once and removes the legacy file', async () => {
    const root = await createRoot()
    const secret = 'legacy-secret'
    await writeFile(
      join(root, 'secrets.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        apiKeyCiphertext: Buffer.from(secret.split('').reverse().join('')).toString('base64'),
      })}\n`,
    )
    const store = new SecretStore(root, {
      isEncryptionAvailable: () => true,
      decryptString: (encrypted) => encrypted.toString().split('').reverse().join(''),
    })

    expect(await store.getApiKey()).toBe(secret)
    expect(JSON.parse(await readFile(join(root, 'auth.json'), 'utf8'))).toEqual({ apiKey: secret })
    await expect(readFile(join(root, 'secrets.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('clears the stored credential', async () => {
    const root = await createRoot()
    const store = new SecretStore(root)
    await store.setApiKey('secret-value')

    await store.clearApiKey()

    expect(await store.getApiKey()).toBeNull()
    expect(await store.hasApiKey()).toBe(false)
  })
})
