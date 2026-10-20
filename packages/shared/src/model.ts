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
