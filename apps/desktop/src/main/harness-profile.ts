import type { ModelEntry, ModelProtocol } from '@pictor/shared'
import { acceptedEfforts } from '@pictor/shared'

import { GUARD_PLUGIN_NAME } from './harness-guard-plugin.js'
/**
 * Route name the kernel sees for the provider Pictor configured.
 *
 * One route is enough: a profile runs one endpoint at a time, and the wire
 * protocol travels with the route instead of being implied by its name.
 */
export const ROUTE = 'pictor'

/** Environment variable the route resolves its key from, per request. */
export const ROUTE_API_KEY_ENV = 'PICTOR_LLM_API_KEY'

/** Bundles the app boots; the profile patch layers on top of them. */
export const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/**
 * Entries the patch switches off.
 *
 * `dsh-base` ships a dedicated DeepSeek route that only ever speaks Messages and
 * refuses a protocol setting outright, so keeping it would leave two endpoints
 * with different URL semantics and no way to tell them apart from settings.
 */
const DISABLED_ENTRIES = ['llm-deepseek', 'llm-deepseek-account']

export interface ProfileSettingsInput {
  protocol: ModelProtocol
  baseUrl: string
  modelId: string
  models: readonly ModelEntry[]
  /** Loopback bridge the guard plugin dials; absent when no guard is installed. */
  guard?: { port: number; token: string }
}

/** The model list the route declares, with a single-entry fallback. */
function routeModels(input: ProfileSettingsInput): ModelEntry[] {
  if (input.models.length > 0) return [...input.models]
  if (input.modelId.length === 0) return []
  return [
    {
      id: input.modelId,
      name: null,
      reasoning: null,
      efforts: null,
      defaultEffort: null,
      input: null,
      contextWindow: null,
      maxTokens: null,
    },
  ]
}

/**
 * The reasoning levels a model offers, as the runtime spells them.
 *
 * `off` is the one level that may leave its wire value empty: it means "send no
 * reasoning parameter at all". Every other level must name the value dispatch
 * sends, and a level left out of the dict is pinned to unsupported — so this
 * declares exactly the levels the settings page ticked, nothing more.
 */
function reasoningEfforts(model: ModelEntry): Record<string, string | null> | null {
  const levels = acceptedEfforts(model)
  if (levels.length === 0) return null
  return { off: null, ...Object.fromEntries(levels.map((level) => [level, level])) }
}

/**
 * Builds the profile's `cordis.patch.yml`.
 *
 * The kernel boots a stack of bundles and then applies this list, so the patch
 * is where a plain configuration becomes the runtime's: one route whose `api` is
 * the protocol the user picked, and the default model pointing at it. The file
 * is written as JSON because YAML is a superset of it — any provider name, model
 * id or URL survives without quoting rules of its own.
 */
export function buildProfilePatch(input: ProfileSettingsInput): string {
  const route = {
    displayName: 'Pictor',
    api: input.protocol,
    baseURL: input.baseUrl,
    apiKeyEnv: ROUTE_API_KEY_ENV,
    models: routeModels(input).map((model) => {
      const efforts = reasoningEfforts(model)
      return {
        id: model.id,
        ...(model.name === null ? {} : { name: model.name }),
        ...(model.reasoning === null ? {} : { reasoning: model.reasoning }),
        ...(efforts === null ? {} : { reasoningEfforts: efforts }),
        ...(model.input === null ? {} : { input: model.input }),
        ...(model.contextWindow === null ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === null ? {} : { maxTokens: model.maxTokens }),
      }
    }),
  }

  const patch: unknown[] = [
    ...DISABLED_ENTRIES.map((id) => ({ id, disabled: true })),
    { id: 'llm-pi-ai', config: { providers: { [ROUTE]: route } } },
    { id: 'agent-default-model', config: { provider: ROUTE, model: input.modelId } },
  ]

  if (input.guard !== undefined) {
    // A user-layer patch can only amend entries the bundle stack already declared,
    // so a new plugin has to arrive through `insert`. Without it the runtime warns
    // `patch: entry "pictor-guard" not found` and the guard silently never runs.
    patch.push({
      insert: [{ id: GUARD_PLUGIN_NAME, name: GUARD_PLUGIN_NAME, config: input.guard }],
    })
  }

  return `${JSON.stringify(patch, null, 2)}\n`
}
