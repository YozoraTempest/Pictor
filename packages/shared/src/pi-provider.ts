import {
  MODEL_EFFORTS,
  type ModelEffort,
  type ModelProtocol,
  type ModelProvider,
  type ProviderView,
} from './model.js'

/**
 * One of Pictor's services, described the way Pi wants it.
 *
 * Pictor keeps providers for the runtime it boots (dsh). Pi is a separate kernel with
 * its own configuration, so without this a person types the same address, key and
 * model list twice and the two kernels drift apart. The bridge here is Pi's own
 * `registerProvider`: Pictor hands Pi what it already knows, and Pi then offers the
 * same services to its conversations.
 */

/**
 * Every service Pictor registers with Pi starts with this.
 *
 * Inside Pictor, Pi runs on its own configuration directory, so the only providers it
 * has are the ones registered here — which makes this prefix the way to tell a model
 * Pictor can still offer from one that belonged to Pi's own config and is gone.
 */
export const PI_PROVIDER_PREFIX = 'pictor-'

/** What Pi calls the wire protocol a model speaks. The names happen to match. */
const PROTOCOLS: Record<ModelProtocol, string | null> = {
  'openai-completions': 'openai-completions',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
}

/** One model, in the shape `registerProvider` accepts. */
export interface PiModelSpec {
  id: string
  name: string
  api: string
  input: string[]
  contextWindow?: number
  maxTokens?: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /**
   * Which provider-level value each level means, and `null` for a level this model
   * does not take.
   *
   * Omitted entirely when Pictor never learned the model's levels: Pi then applies its
   * own default, which is a better answer than a map invented here.
   */
  thinkingLevelMap?: Record<string, string | null>
}

/** One service, in the shape `registerProvider` accepts. */
export interface PiProviderSpec {
  /** Name Pi registers it under; unique across the list. */
  name: string
  apiKey: string
  baseUrl: string
  models: PiModelSpec[]
}

/** Why one service cannot be handed to Pi. */
export interface PiProviderSkip {
  providerId: string
  name: string
  reason: string
}

/**
 * The name Pi will know a provider by.
 *
 * Its own config already holds providers by plain names (`deepseek`, `neko`), so a
 * prefixed, slugged name keeps clear of them: `pictor-deepseek`. A slug that comes out
 * empty falls back to the id, which is always there.
 */
export function piProviderName(provider: Pick<ModelProvider, 'id' | 'name'>): string {
  const slug = provider.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `${PI_PROVIDER_PREFIX}${slug.length > 0 ? slug : provider.id.replace(/[^a-z0-9]+/gu, '').slice(0, 8)}`
}

/**
 * The levels a model takes, as a map Pi understands.
 *
 * Pictor stores the levels a person narrowed to; the wire spelling of a level is its
 * own name, so each accepted level maps to itself and the rest map to `null`. `null`
 * here means "this model does not take it", which is different from the levels never
 * having been declared — that case returns `undefined` so the map is left out.
 */
export function piThinkingLevelMap(
  efforts: readonly ModelEffort[] | null,
): Record<string, string | null> | undefined {
  if (efforts === null) return undefined
  const accepted = new Set(efforts)
  return Object.fromEntries(
    MODEL_EFFORTS.map((level) => [level, accepted.has(level) ? level : null]),
  )
}

/**
 * Whether one service can run on Pi, and the name it will have there.
 *
 * The reasons are the page's words as much as the caller's: a service missing a key
 * or a model is not broken for dsh, it simply has nothing to hand over yet.
 */
export function piProviderPlan(
  provider: ProviderView,
): { ok: true; name: string; models: number } | { ok: false; reason: string } {
  if (PROTOCOLS[provider.protocol] === null) return { ok: false, reason: '协议不被 Pi 支持' }
  if (provider.baseUrl.trim().length === 0) return { ok: false, reason: '还没有地址' }
  if (provider.models.length === 0) return { ok: false, reason: '还没有模型' }
  if (!provider.hasApiKey) return { ok: false, reason: '还没有密钥' }
  return { ok: true, name: piProviderName(provider), models: provider.models.length }
}

/** One model as Pi's registration wants it. */
function piModelSpecOf(
  provider: ModelProvider,
  model: ModelProvider['models'][number],
): PiModelSpec {
  const api = PROTOCOLS[provider.protocol] ?? 'openai-completions'
  const map = piThinkingLevelMap(model.efforts)
  return {
    id: model.id,
    name: model.name ?? model.id,
    api,
    // Without a declared input list, text is the only safe claim: saying "images" for a
    // model that cannot see them makes Pi send an image and fail at the provider.
    input: model.input ?? ['text'],
    ...(model.contextWindow === null ? {} : { contextWindow: model.contextWindow }),
    ...(model.maxTokens === null ? {} : { maxTokens: model.maxTokens }),
    // Pictor does not track prices; zero keeps Pi from showing a made-up cost.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(map === undefined ? {} : { thinkingLevelMap: map }),
  }
}

/**
 * Every service Pictor can hand to Pi, plus the ones it cannot and why.
 *
 * Keys are passed in rather than read here: the caller owns the auth file, and this
 * stays a pure function a test can drive.
 */
export function piProvidersOf(
  providers: readonly ProviderView[],
  keyOf: (providerId: string) => string | null,
  /**
   * The service and model Pictor itself is using.
   *
   * Pi starts on the first model it knows when nobody has chosen one, so the order
   * here decides what a fresh conversation runs on. Putting Pictor's active model
   * first makes that default the same one dsh uses, instead of whichever service
   * happened to be registered first.
   */
  active?: { providerId: string | null; modelId: string } | null,
): { providers: PiProviderSpec[]; skipped: PiProviderSkip[] } {
  const specs: PiProviderSpec[] = []
  const skipped: PiProviderSkip[] = []
  const taken = new Set<string>()

  const ordered =
    active?.providerId == null
      ? [...providers]
      : [
          ...providers.filter((provider) => provider.id === active.providerId),
          ...providers.filter((provider) => provider.id !== active.providerId),
        ]

  for (const provider of ordered) {
    const plan = piProviderPlan(provider)
    if (!plan.ok) {
      skipped.push({ providerId: provider.id, name: provider.name, reason: plan.reason })
      continue
    }

    const apiKey = keyOf(provider.id)
    if (apiKey === null) {
      skipped.push({ providerId: provider.id, name: provider.name, reason: '还没有密钥' })
      continue
    }

    // Two services with the same display name would otherwise register under one
    // name and the second would replace the first.
    let name = plan.name
    for (let suffix = 2; taken.has(name); suffix += 1) name = `${plan.name}-${String(suffix)}`
    taken.add(name)

    const models = provider.models.map((model) => piModelSpecOf(provider, model))
    if (active?.providerId === provider.id) {
      // Within the active service, the model in use goes first for the same reason.
      const index = models.findIndex((model) => model.id === active.modelId)
      if (index > 0) models.unshift(...models.splice(index, 1))
    }

    specs.push({ name, apiKey, baseUrl: provider.baseUrl, models })
  }

  return { providers: specs, skipped }
}
