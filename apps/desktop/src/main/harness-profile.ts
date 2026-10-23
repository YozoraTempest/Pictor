import type { ModelEntry, ModelProtocol } from '@pictor/shared'

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
      input: null,
      contextWindow: null,
      maxTokens: null,
    },
  ]
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
    models: routeModels(input).map((model) => ({
      id: model.id,
      ...(model.name === null ? {} : { name: model.name }),
      ...(model.reasoning === null ? {} : { reasoning: model.reasoning }),
      ...(model.input === null ? {} : { input: model.input }),
      ...(model.contextWindow === null ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === null ? {} : { maxTokens: model.maxTokens }),
    })),
  }

  const patch = [
    ...DISABLED_ENTRIES.map((id) => ({ id, disabled: true })),
    { id: 'llm-pi-ai', config: { providers: { [ROUTE]: route } } },
    { id: 'agent-default-model', config: { provider: ROUTE, model: input.modelId } },
  ]

  return `${JSON.stringify(patch, null, 2)}\n`
}
