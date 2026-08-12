// @vitest-environment node

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RuntimeEvent, RuntimeStartConfig } from '../shared/runtime-protocol.js'
import { REDACTED_SECRET } from '../shared/secret-redaction.js'
import { PiAgentRuntime } from './pi-adapter.js'

const sessionFactory = async () => ({
  subscribe: () => () => undefined,
  prompt: async () => undefined,
  abort: async () => undefined,
  waitForIdle: async () => undefined,
  dispose: () => undefined,
})

describe('PiAgentRuntime cleanup', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pictor-runtime-cleanup-'))
    await mkdir(join(root, 'project'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.each(['a', 'id', 'running'])(
    'releases the runtime after initial event emission fails for short key %s',
    async (secret) => {
      const events: RuntimeEvent[] = []
      let rejectNextEvent = true
      const runtime = new PiAgentRuntime((event) => {
        if (rejectNextEvent) {
          rejectNextEvent = false
          throw new Error(`Event emission failed with ${secret}`)
        }
        events.push(event)
      }, sessionFactory)
      const baseConfig = {
        type: 'start',
        sessionId: '11234567-89ab-4def-8123-456789abcdef',
        messageId: '21234567-89ab-4def-8123-456789abcdef',
        projectRoot: join(root, 'project'),
        agentDirectory: join(root, 'agent'),
        sessionDirectory: join(root, 'session'),
        resumeSession: false,
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 64,
        },
        apiKey: secret,
        prompt: `prompt ${secret}`,
      } satisfies Omit<RuntimeStartConfig, 'runId'>

      await runtime.start({
        ...baseConfig,
        runId: '01234567-89ab-4def-8123-456789abcdef',
      })

      expect(events.at(-1)).toMatchObject({
        type: 'run.stateChanged',
        runId: '01234567-89ab-4def-8123-456789abcdef',
        status: 'failed',
      })
      const runtimeError = events.find(
        (event): event is Extract<RuntimeEvent, { type: 'runtime.error' }> =>
          event.type === 'runtime.error',
      )
      const failedEvent = events.find(
        (event): event is Extract<RuntimeEvent, { type: 'run.stateChanged' }> =>
          event.type === 'run.stateChanged' && event.status === 'failed',
      )
      expect(runtimeError?.message).toContain(REDACTED_SECRET)
      expect(runtimeError?.message).not.toContain(secret)
      expect(failedEvent?.error).not.toContain(secret)

      await runtime.start({
        ...baseConfig,
        runId: '31234567-89ab-4def-8123-456789abcdef',
      })

      expect(events.at(-1)).toMatchObject({
        type: 'run.stateChanged',
        runId: '31234567-89ab-4def-8123-456789abcdef',
        status: 'completed',
      })
    },
  )
})
