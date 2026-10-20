import { describe, expect, it } from 'vitest'

import { fetchModels, testConnection } from './probe.js'

/**
 * Opt-in live check. It reads everything from the environment so no endpoint or
 * key is ever committed:
 *
 *   PICTOR_LIVE_BASE_URL, PICTOR_LIVE_MODEL, PICTOR_LIVE_API_KEY
 *
 * Run with `PICTOR_LIVE_TEST=1 pnpm vitest run packages/model-config/src/live.test.ts`.
 */
const enabled =
  process.env.PICTOR_LIVE_TEST === '1' &&
  typeof process.env.PICTOR_LIVE_BASE_URL === 'string' &&
  typeof process.env.PICTOR_LIVE_MODEL === 'string'

describe.skipIf(!enabled)('live endpoint', () => {
  it('lists models and completes one request', async () => {
    const endpoint = {
      baseUrl: process.env.PICTOR_LIVE_BASE_URL ?? '',
      protocol: 'chat-completions' as const,
      apiKey: process.env.PICTOR_LIVE_API_KEY ?? null,
    }

    const models = await fetchModels(endpoint)
    expect(models.length).toBeGreaterThan(0)

    const result = await testConnection({
      ...endpoint,
      modelId: process.env.PICTOR_LIVE_MODEL ?? '',
    })

    expect(result).toMatchObject({ ok: true })
    expect(result.sample.length).toBeGreaterThan(0)
  }, 60_000)
})
