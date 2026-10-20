import type { ModelEntry, ModelProtocol } from '@pictor/shared'

import { normalizeBaseUrl } from './settings.js'

export type FetchLike = typeof fetch

export interface ProbeEndpoint {
  baseUrl: string
  protocol: ModelProtocol
  apiKey: string | null
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  sample: string
}

const TIMEOUT_MS = 20_000

function headers(endpoint: ProbeEndpoint): Record<string, string> {
  const result: Record<string, string> = { 'content-type': 'application/json' }
  if (endpoint.apiKey !== null && endpoint.apiKey.trim().length > 0) {
    result.authorization = `Bearer ${endpoint.apiKey.trim()}`
  }
  return result
}

function endpointUrl(endpoint: ProbeEndpoint, path: string): string {
  return `${normalizeBaseUrl(endpoint.baseUrl)}${path}`
}

function truncate(value: string, limit = 300): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact
}

/** Lists models from an OpenAI-compatible `/models` endpoint. */
export async function fetchModels(
  endpoint: ProbeEndpoint,
  fetchImpl: FetchLike = fetch,
): Promise<ModelEntry[]> {
  const response = await fetchImpl(endpointUrl(endpoint, '/models'), {
    method: 'GET',
    headers: headers(endpoint),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${truncate(body)}`)
  }

  const payload = (await response.json()) as { data?: unknown }
  if (!Array.isArray(payload.data)) {
    throw new Error('response does not contain a data array')
  }

  const models: ModelEntry[] = []
  for (const item of payload.data) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.trim().length === 0) continue

    models.push({
      id: record.id,
      name: typeof record.name === 'string' ? record.name : null,
      reasoning: null,
      input: null,
      contextWindow: null,
      maxTokens: null,
    })
  }

  return models.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Sends one minimal completion to prove protocol, authentication and that the
 * model actually answers.
 */
export async function testConnection(
  endpoint: ProbeEndpoint & { modelId: string },
  fetchImpl: FetchLike = fetch,
): Promise<ConnectionTestResult> {
  if (endpoint.modelId.trim().length === 0) {
    return { ok: false, message: 'No model selected', sample: '' }
  }

  const isResponses = endpoint.protocol === 'responses'
  const url = endpointUrl(endpoint, isResponses ? '/responses' : '/chat/completions')
  const body = isResponses
    ? {
        model: endpoint.modelId,
        input: 'Reply with the single word: ok',
        max_output_tokens: 32,
      }
    : {
        model: endpoint.modelId,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 32,
        temperature: 0,
      }

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: headers(endpoint),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, message: `Request failed: ${(error as Error).message}`, sample: '' }
  }

  const raw = await response.text().catch(() => '')

  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${truncate(raw)}`, sample: '' }
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return { ok: false, message: 'Response was not JSON', sample: truncate(raw) }
  }

  const sample = isResponses ? extractResponsesText(payload) : extractChatText(payload)
  return {
    ok: true,
    message: 'Connection succeeded',
    sample: sample.length > 0 ? sample : truncate(raw),
  }
}

function extractChatText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''

  const first = choices[0]
  if (typeof first !== 'object' || first === null) return ''
  const message = (first as Record<string, unknown>).message
  if (typeof message !== 'object' || message === null) return ''

  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'object' && part !== null) {
        const text = (part as Record<string, unknown>).text
        if (typeof text === 'string') return text
      }
      return ''
    })
    .join('')
}

function extractResponsesText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const record = payload as Record<string, unknown>

  if (typeof record.output_text === 'string') return record.output_text
  if (!Array.isArray(record.output)) return ''

  const parts: string[] = []
  for (const item of record.output) {
    if (typeof item !== 'object' || item === null) continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const text = (block as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }

  return parts.join('')
}
