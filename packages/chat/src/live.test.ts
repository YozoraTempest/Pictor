import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ChatService } from './chat-service.js'
import { loadHistoryPage } from './history.js'
import type { ChatEvent } from './types.js'

/**
 * Opt-in live check for the full chat loop: real Pi session, JSONL persistence
 * and history recovery. Values come from the environment only.
 *
 *   PICTOR_LIVE_CHAT=1 PICTOR_LIVE_BASE_URL=... PICTOR_LIVE_MODEL=... PICTOR_LIVE_API_KEY=...
 */
const enabled =
  process.env.PICTOR_LIVE_CHAT === '1' &&
  typeof process.env.PICTOR_LIVE_BASE_URL === 'string' &&
  typeof process.env.PICTOR_LIVE_MODEL === 'string'

describe.skipIf(!enabled)('ChatService live', () => {
  it('streams a reply, persists JSONL and reloads history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pictor-live-chat-'))
    const modelsPath = join(directory, 'models.json')
    const modelId = process.env.PICTOR_LIVE_MODEL ?? ''

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

    const events: ChatEvent[] = []
    const service = new ChatService({ onEvent: (event) => events.push(event) })

    const opened = await service.open({
      sessionId: 'live',
      cwd: directory,
      sessionDir: join(directory, 'sessions'),
      agentDir: join(directory, 'agent'),
      modelsPath,
      modelId,
      apiKey: process.env.PICTOR_LIVE_API_KEY ?? null,
      sessionPath: null,
    })

    expect(opened.path).toContain('sessions')

    await service.send('Answer with the single word: ok')
    const firstRun = events.filter((event) => event.type === 'run.finished')
    expect(firstRun.at(-1)).toMatchObject({ reason: 'stop' })

    // Second run must work too: the key is re-injected for every prompt.
    await service.send('Answer with the single word: ok again')
    const runs = events.filter((event) => event.type === 'run.finished')
    expect(runs).toHaveLength(2)
    expect(runs.every((event) => event.type === 'run.finished' && event.reason === 'stop')).toBe(
      true,
    )
    expect(events.filter((event) => event.type === 'message.delta').length).toBeGreaterThan(1)

    const history = await loadHistoryPage(opened.path, 50, 0)
    expect(history.messages.some((message) => message.role === 'user')).toBe(true)
    expect(history.messages.some((message) => message.role === 'assistant')).toBe(true)

    await service.close()

    const recovered = new ChatService({ onEvent: () => undefined })
    const reopened = await recovered.open({
      sessionId: 'live',
      cwd: directory,
      sessionDir: join(directory, 'sessions'),
      agentDir: join(directory, 'agent'),
      modelsPath,
      modelId,
      apiKey: process.env.PICTOR_LIVE_API_KEY ?? null,
      sessionPath: opened.path,
    })

    expect(reopened.path).toBe(opened.path)
    await recovered.close()
  }, 180_000)
})
