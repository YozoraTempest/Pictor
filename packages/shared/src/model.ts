/**
 * Wire protocol an endpoint speaks.
 *
 * The values are the runtime's own vocabulary (`llm-pi-ai`'s `api` field), so a
 * configured provider reaches the kernel without a translation table in between.
 */
export type ModelProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

/** Every protocol the runtime can speak, in the order settings offer them. */
export const MODEL_PROTOCOLS: readonly ModelProtocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
]

/**
 * One reasoning level a model can be asked for, weakest first.
 *
 * The names are the runtime's own (`THINKING_LEVELS` in `llm-pi-ai`), and the
 * default wire spelling of a level is the name itself, so what the settings page
 * offers is exactly what leaves for the endpoint.
 */
export type ModelEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Every level a model may declare, in the order the picker shows them. */
export const MODEL_EFFORTS: readonly ModelEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/**
 * What ticking "reasoning" declares when nobody narrows it.
 *
 * Three levels are what OpenAI-compatible endpoints accept as `reasoning_effort`;
 * `minimal` and the two above `high` are narrower vendor extensions, so they stay
 * opt-in in settings.
 */
export const DEFAULT_MODEL_EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high']

export interface ModelEntry {
  id: string
  name: string | null
  reasoning: boolean | null
  /**
   * Levels the model accepts, weakest first; `null` means never declared, which
   * {@link acceptedEfforts} resolves against the reasoning flag. Storing the
   * levels the user narrowed is what makes "high only" survive a reopen.
   */
  efforts: ModelEffort[] | null
  input: string[] | null
  contextWindow: number | null
  maxTokens: number | null
}

/**
 * The levels a model actually accepts.
 *
 * A model that only says it reasons predates the level list, so it gets the
 * standard three: the settings page shows them ticked, the picker offers them, and
 * the route declares them. Anything else would leave "supports reasoning" as a
 * capability with no control behind it.
 */
export function acceptedEfforts(
  entry: Pick<ModelEntry, 'reasoning' | 'efforts'> | undefined,
): ModelEffort[] {
  if (entry === undefined) return []
  if (entry.efforts !== null) return entry.efforts
  return entry.reasoning === true ? [...DEFAULT_MODEL_EFFORTS] : []
}

/** Non-secret model configuration plus a mask of whether a key is stored. */
export interface ModelSettings {
  /** Provider the runtime uses; `null` when none is configured yet. */
  providerId: string | null
  providerName: string
  baseUrl: string
  protocol: ModelProtocol
  modelId: string
  models: ModelEntry[]
  hasApiKey: boolean
}

export interface ModelSettingsInput {
  providerName: string
  baseUrl: string
  protocol: ModelProtocol
  modelId: string
  models: ModelEntry[]
  /** Omit to keep the stored key; send an empty string to clear it. */
  apiKey?: string
}

/** One configured endpoint, as stored and as the settings page sees it. */
export interface ModelProvider {
  id: string
  name: string
  baseUrl: string
  protocol: ModelProtocol
  /** Model used when this provider is active; empty until one is picked. */
  modelId: string
  /** Model ids the endpoint reported, kept for the picker. */
  models: ModelEntry[]
}

export interface ProviderView extends ModelProvider {
  /** Whether a key is stored for this provider; the key itself never leaves the host. */
  hasApiKey: boolean
}

export interface ProviderList {
  providers: ProviderView[]
  activeId: string | null
}

export interface ProviderInput {
  /** Omitted when adding; present when editing. */
  id?: string
  name: string
  baseUrl: string
  protocol: ModelProtocol
  modelId: string
  models: ModelEntry[]
  /** Left out to keep the stored key, empty string to clear it. */
  apiKey?: string
}

export interface CcSwitchProviderSummary {
  id: string
  name: string
  baseUrl: string
  api: string | null
  models: ModelEntry[]
  hasApiKey: boolean
}

export interface CcSwitchProviderDetail extends CcSwitchProviderSummary {
  apiKey: string | null
}
