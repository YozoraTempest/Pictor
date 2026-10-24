import type { ModelEffort, ModelEntry } from '@pictor/shared'
import { DEFAULT_MODEL_EFFORTS } from '@pictor/shared'

/** What a model can do, as far as the runtime is concerned. */
export interface Capabilities {
  /** Accepts images beside the text. */
  image: boolean
  /** Supports a reasoning channel. */
  reasoning: boolean
  /** Levels it accepts when it does reason; `null` means none were declared. */
  efforts: ModelEffort[] | null
  contextWindow: number | null
  maxTokens: number | null
}

const IMAGE = 'image'

/** An entry the endpoint listed but said nothing about. */
export function emptyModel(id: string, name: string | null = null): ModelEntry {
  return {
    id,
    name,
    reasoning: null,
    efforts: null,
    input: null,
    contextWindow: null,
    maxTokens: null,
  }
}

export function capabilitiesOf(entry: ModelEntry | undefined): Capabilities {
  return {
    image: entry?.input?.includes(IMAGE) ?? false,
    reasoning: entry?.reasoning === true,
    efforts: entry?.efforts ?? null,
    contextWindow: entry?.contextWindow ?? null,
    maxTokens: entry?.maxTokens ?? null,
  }
}

/**
 * Write capabilities back onto one model.
 *
 * A model can be nothing but a typed id, so the row this edits may not exist yet;
 * declaring a capability is what creates it.
 */
export function withCapabilities(
  entries: readonly ModelEntry[],
  id: string,
  capabilities: Partial<Capabilities>,
): ModelEntry[] {
  const index = entries.findIndex((entry) => entry.id === id)
  const base = index >= 0 ? (entries[index] as ModelEntry) : emptyModel(id)
  const image = capabilities.image ?? base.input?.includes(IMAGE) ?? false
  const reasoning = capabilities.reasoning ?? base.reasoning
  // Ticking the switch is what makes levels exist: an entry that has none picks up
  // the standard three, and unticking it clears them so the request stops claiming
  // a level the model no longer offers.
  const efforts =
    capabilities.efforts !== undefined
      ? capabilities.efforts
      : reasoning === true
        ? (base.efforts ?? [...DEFAULT_MODEL_EFFORTS])
        : null
  const next: ModelEntry = {
    ...base,
    // `null` on the entry means "never declared", so an untouched field keeps it
    // instead of flattening to false.
    reasoning,
    efforts,
    // Only an explicit answer changes the modality list: `null` means "the
    // endpoint never said", which is not the same as "text only".
    input: capabilities.image === undefined ? base.input : image ? ['text', IMAGE] : ['text'],
    contextWindow:
      capabilities.contextWindow === undefined ? base.contextWindow : capabilities.contextWindow,
    maxTokens: capabilities.maxTokens === undefined ? base.maxTokens : capabilities.maxTokens,
  }

  if (index < 0) return [...entries, next]
  return entries.map((entry, at) => (at === index ? next : entry))
}

/**
 * Fold a fresh listing into what is already configured.
 *
 * The endpoint is the authority on *which* models exist; the app is the authority
 * on what they can do, because almost no endpoint reports it. Refreshing therefore
 * keeps the capabilities someone typed, and only drops ids the endpoint no longer
 * lists.
 */
export function mergeModels(
  existing: readonly ModelEntry[],
  fetched: readonly ModelEntry[],
): ModelEntry[] {
  const known = new Map(existing.map((entry) => [entry.id, entry]))
  return fetched.map((listed) => {
    const kept = known.get(listed.id)
    if (kept === undefined) return listed
    return {
      id: kept.id,
      // What the endpoint reports wins for display fields; capabilities are ours.
      name: listed.name ?? kept.name,
      reasoning: kept.reasoning ?? listed.reasoning,
      efforts: kept.efforts ?? listed.efforts,
      input: kept.input ?? listed.input,
      contextWindow: kept.contextWindow ?? listed.contextWindow,
      maxTokens: kept.maxTokens ?? listed.maxTokens,
    }
  })
}
