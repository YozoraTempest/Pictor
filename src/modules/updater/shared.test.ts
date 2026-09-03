import { expect, it, vi } from 'vitest'

import type { ModuleTransport } from '../../kernel/contract.js'
import { createUpdaterClient } from './shared.js'

it('invokes and validates the Updater contract through Module transport', async () => {
  const snapshot = {
    appInfo: {
      name: 'Pictor',
      version: '0.3.0',
      buildChannel: 'stable',
      sourceCommit: 'a'.repeat(40),
      platform: 'win32',
      arch: 'x64',
      distribution: 'windows',
    },
    channel: 'nightly',
  }
  const invoke = vi.fn(async () => snapshot)
  const transport: ModuleTransport = {
    invoke,
    onEvent: vi.fn(() => () => undefined),
  }
  const client = createUpdaterClient(transport)

  await expect(client.setChannel('nightly')).resolves.toEqual(snapshot)
  expect(invoke).toHaveBeenCalledWith('pictor.updater', 'setChannel', {
    channel: 'nightly',
  })
})
