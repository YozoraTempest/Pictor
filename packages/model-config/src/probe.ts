import type { ModelEntry, ModelProtocol } from '@vulonlok/shared'

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

/** One prompt every protocol can answer, so a probe never depends on wording. */
const PROBE_PROMPT = 'Reply with the single word: ok'

function headers(endpoint: ProbeEndpoint): Record<string, string> {
  const result: Record<string, string> = { 'content-type': 'application/json' }
  const key = endpoint.apiKey?.trim() ?? ''
  if (key.length === 0) return result
  // The Messages API names the key header itself and requires a version pin;
  // an Authorization header there authenticates nothing.
  if (endpoint.protocol === 'anthropic-messages') {
    result['x-api-key'] = key
    result['anthropic-version'] = '2023-06-01'
    return result
  }
  result.authorization = `Bearer ${key}`
  return result
}

function endpointUrl(endpoint: ProbeEndpoint, path: string): string {
  // Messages endpoints publish the version segment as part of the root, and the
  // SDK appends `/messages` to whatever it is given.
  if (endpoint.protocol === 'anthropic-messages') {
    const base = normalizeBaseUrl(endpoint.baseUrl)
    return `${base.endsWith('/v1') ? base : `${base}/v1`}${path}`
  }
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
      reasoning: typeof record.reasoning === 'boolean' ? record.reasoning : null,
      // Discovery says whether a model reasons, never which levels it takes, so the
      // level list stays undeclared here; the settings page is where it is designed.
      efforts: null,
      defaultEffort: null,
      input: modalitiesOf(record),
      contextWindow:
        positiveOf(record['context_window']) ??
        positiveOf(record['context_length']) ??
        positiveOf(record['max_model_len']),
      maxTokens: positiveOf(record['max_output_tokens']) ?? positiveOf(record['max_tokens']),
    })
  }

  return models.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Modalities a listing declared, in the runtime's vocabulary.
 *
 * Endpoints disagree on the field and most say nothing at all; `null` keeps
 * "unknown" distinct from "text only", because the settings page lets a person
 * declare what the endpoint withheld.
 */
function modalitiesOf(record: Record<string, unknown>): string[] | null {
  for (const value of [record['input_modalities'], record['modalities']]) {
    if (!Array.isArray(value)) continue
    const names = value.filter((item): item is string => typeof item === 'string')
    if (names.length === 0) continue
    return names.includes('image') ? ['text', 'image'] : ['text']
  }
  return null
}

function positiveOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
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

  const url = endpointUrl(
    endpoint,
    endpoint.protocol === 'openai-responses'
      ? '/responses'
      : endpoint.protocol === 'anthropic-messages'
        ? '/messages'
        : '/chat/completions',
  )
  // One prompt, three envelopes: each protocol names the ceiling and the reply
  // differently, so the body is built per protocol rather than patched.
  const body =
    endpoint.protocol === 'openai-responses'
      ? {
          model: endpoint.modelId,
          input: PROBE_PROMPT,
          max_output_tokens: 32,
        }
      : {
          model: endpoint.modelId,
          messages: [{ role: 'user', content: PROBE_PROMPT }],
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

  const sample =
    endpoint.protocol === 'openai-responses'
      ? extractResponsesText(payload)
      : endpoint.protocol === 'anthropic-messages'
        ? extractMessagesText(payload)
        : extractChatText(payload)
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

/** Messages replies carry typed blocks; only the text ones are the answer. */
function extractMessagesText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const content = (payload as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block): string[] => {
      if (typeof block !== 'object' || block === null) return []
      const entry = block as Record<string, unknown>
      return entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []
    })
    .join('')
}
