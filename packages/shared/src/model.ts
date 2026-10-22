/** Wire protocol spoken by an OpenAI-compatible endpoint. */
export type ModelProtocol = 'chat-completions' | 'responses'

export interface ModelEntry {
  id: string
  name: string | null
  reasoning: boolean | null
  input: string[] | null
  contextWindow: number | null
  maxTokens: number | null
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
