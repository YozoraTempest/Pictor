import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { JsonValue, ModelEntry, ModelSettings } from '@pictor/shared'

/** Environment variable that carries the key into Pi at request time. */
export const API_KEY_ENV = 'PICTOR_PROVIDER_API_KEY'

export function piApiName(protocol: ModelSettings['protocol']): string {
  return protocol === 'responses' ? 'openai-responses' : 'openai-completions'
}

/**
 * Builds the Pi `models.json` document for the configured endpoint.
 *
 * The key is referenced through environment interpolation, so the secret never
 * lands in this file.
 */
export function buildModelsJson(settings: ModelSettings): JsonValue {
  const models: ModelEntry[] =
    settings.models.length > 0
      ? settings.models
      : settings.modelId.length > 0
        ? [
            {
              id: settings.modelId,
              name: null,
              reasoning: null,
              input: null,
              contextWindow: null,
              maxTokens: null,
            },
          ]
        : []

  return {
    $schema: 'https://pi.dev/schemas/models.schema.json',
    providers: {
      pictor: {
        baseUrl: settings.baseUrl,
        api: piApiName(settings.protocol),
        apiKey: `$${API_KEY_ENV}`,
        models: models.map(toPiModel),
      },
    },
  } as unknown as JsonValue
}

function toPiModel(model: ModelEntry): Record<string, JsonValue> {
  const entry: Record<string, JsonValue> = { id: model.id }

  if (model.name !== null && model.name.length > 0) entry.name = model.name
  if (model.reasoning !== null) entry.reasoning = model.reasoning
  if (model.input !== null && model.input.length > 0) entry.input = model.input
  if (model.contextWindow !== null) entry.contextWindow = model.contextWindow
  if (model.maxTokens !== null) entry.maxTokens = model.maxTokens

  return entry
}

export function writeModelsJson(path: string, settings: ModelSettings): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(buildModelsJson(settings), null, 2)}\n`, { mode: 0o600 })
}
