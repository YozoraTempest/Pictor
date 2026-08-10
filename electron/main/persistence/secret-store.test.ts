// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CredentialUnavailableError, SecretStore } from './secret-store.js'

describe('SecretStore', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('persists ciphertext and never plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-secrets-'))
    roots.push(root)
    const adapter = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`encrypted:${plainText.length}`),
      decryptString: () => 'secret-value',
    }
    const store = new SecretStore(root, adapter)

    await store.setApiKey('secret-value')

    expect(await store.getApiKey()).toBe('secret-value')
    expect(await store.hasApiKey()).toBe(true)
    expect(await readFile(join(root, 'secrets.json'), 'utf8')).not.toContain('secret-value')
  })

  it('fails closed when Windows encryption is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-secrets-'))
    roots.push(root)
    const store = new SecretStore(root, {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    })

    await expect(store.setApiKey('secret-value')).rejects.toBeInstanceOf(CredentialUnavailableError)
  })
})
