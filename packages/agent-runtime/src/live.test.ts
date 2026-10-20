import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PiAgentRuntime } from './pi-adapter.js'
import type { AgentEvent } from './runtime.js'

/**
 * Opt-in live check that drives the real Pi SDK against an OpenAI-compatible
 * endpoint. Configuration comes from the environment only:
 *
 *   PICTOR_LIVE_BASE_URL, PICTOR_LIVE_MODEL, PICTOR_LIVE_API_KEY
 */
const enabled =
  process.env.PICTOR_LIVE_AGENT === '1' &&
  typeof process.env.PICTOR_LIVE_BASE_URL === 'string' &&
  typeof process.env.PICTOR_LIVE_MODEL === 'string'

describe.skipIf(!enabled)('PiAgentRuntime live', () => {
  it('streams one assistant reply', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pictor-live-agent-'))
    const modelId = process.env.PICTOR_LIVE_MODEL ?? ''
    const modelsPath = join(directory, 'models.json')
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          pictor: {
            baseUrl: process.env.PICTOR_LIVE_BASE_URL ?? '',
            api: 'openai-completions',
            apiKey: '$PICTOR_PROVIDER_API_KEY',
            models: [{ id: modelId }],
          },
        },
      }),
    )

    const runtime = new PiAgentRuntime({
      loadConfig: async () => ({
        modelId,
        modelsPath,
        agentDir: join(directory, 'agent'),
        apiKey: process.env.PICTOR_LIVE_API_KEY ?? null,
        workingDirectory: directory,
      }),
    })

    const events: AgentEvent[] = []
    let text = ''

    const handle = await runtime.run(
      { runId: 'live', prompt: 'Reply with the single word: ok', workingDirectory: directory },
      (event) => {
        events.push(event)
        if (event.type === 'message.delta') text += event.text
      },
    )

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && !events.some((event) => event.type === 'run.finished')) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (!events.some((event) => event.type === 'run.finished')) handle.cancel()

    expect(text.length).toBeGreaterThan(0)
    expect(events.some((event) => event.type === 'run.finished')).toBe(true)
  }, 150_000)
})
