import type { ModelEffort, ModelEntry } from '@pictor/shared'
import { acceptedEfforts, defaultEffortOf, OMIT_EFFORT } from '@pictor/shared'

/** Levels this model accepts, in the order the slider shows them. */
export function effortsOf(model: ModelEntry | undefined): ModelEffort[] {
  return acceptedEfforts(model)
}

/**
 * The level one model is designed to start at, or `null` for {@link OMIT_EFFORT}.
 *
 * This lives in the model's own settings, so the composer can follow it instead of
 * asking again: picking a model is enough to get the behaviour configured for it.
 */
export function designedEffort(model: ModelEntry | undefined): ModelEffort | null {
  return defaultEffortOf(model)
}

/**
 * The level the slider can show, or `null` for "send nothing".
 *
 * A choice survives only while the model still offers that level: sending one it
 * dropped would fail the turn, and showing it would promise what cannot happen.
 */
export function pickEffort(
  levels: readonly ModelEffort[],
  chosen: ModelEffort | null,
): ModelEffort | null {
  return chosen !== null && levels.includes(chosen) ? chosen : null
}

/**
 * How one level reads, which is the level's own name.
 *
 * Providers disagree about what these are called and what each one buys, so
 * translating them would invent a common denominator that does not exist. The one
 * exception is "no level at all": that is not a level, and it says what happens.
 */
export function effortLabel(level: ModelEffort | null): string {
  return level ?? OMIT_EFFORT
}

/**
 * Colour that carries how much thinking the level buys, cool to warm.
 *
 * Returned as a class rather than a colour so the theme stays in one place.
 */
export function effortTone(level: ModelEffort | null): string {
  if (level === 'minimal' || level === 'low') return 'text-effort-low'
  if (level === 'medium') return 'text-effort-mid'
  if (level === 'high') return 'text-effort-high'
  if (level === 'xhigh' || level === 'max') return 'text-effort-max'
  return 'text-faint'
}

/** The colour of one level as a CSS value, for parts that cannot take a class. */
export function effortColor(level: ModelEffort | null): string {
  if (level === 'minimal' || level === 'low') return 'var(--color-effort-low)'
  if (level === 'medium') return 'var(--color-effort-mid)'
  if (level === 'high') return 'var(--color-effort-high)'
  if (level === 'xhigh' || level === 'max') return 'var(--color-effort-max)'
  return 'var(--color-border-strong)'
}
