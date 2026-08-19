import type { ModelRuntimeProvider } from './plugin-interface.js'

const PROVIDER_ID = 'pictor-openai-compatible'

export const openAiCompatibleModelProvider: ModelRuntimeProvider = {
  id: PROVIDER_ID,
  register(runtime, settings, apiKey) {
    const api = settings.apiProtocol === 'responses' ? 'openai-responses' : 'openai-completions'
    const reasoningEnabled = settings.reasoningEffort !== null
    runtime.registerProvider(PROVIDER_ID, {
      name: 'Pictor OpenAI-compatible endpoint',
      api,
      baseUrl: settings.baseUrl,
      apiKey,
      authHeader: true,
      models: [
        {
          id: settings.modelId,
          name: settings.modelId,
          api,
          reasoning: reasoningEnabled,
          ...(reasoningEnabled ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: settings.maxOutputTokens ?? 8192,
          ...(api === 'openai-completions' && reasoningEnabled
            ? { compat: { supportsReasoningEffort: true } }
            : {}),
          ...(settings.temperature === null
            ? {}
            : { samplingParams: { temperature: settings.temperature } }),
        },
      ],
    })
    const model = runtime.getModel(PROVIDER_ID, settings.modelId)
    if (!model) throw new Error(`Model is unavailable: ${settings.modelId}`)
    return model
  },
}
