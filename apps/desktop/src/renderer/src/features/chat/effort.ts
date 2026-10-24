import type { ModelEffort, ModelEntry } from '@pictor/shared'
import { MODEL_EFFORTS } from '@pictor/shared'

/** How each level reads in the picker; the wire spelling stays English. */
const LABELS: Record<ModelEffort, string> = {
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

/** Where the chosen level survives a restart. */
const STORAGE_KEY = 'pictor.model.effort'

/** Levels this model accepts, in the order the slider shows them. */
export function effortsOf(model: ModelEntry | undefined): ModelEffort[] {
  return model?.efforts ?? []
}

/**
 * The level to actually send.
 *
 * A saved level only survives while the model it was chosen for still offers it:
 * switching to a model without that level must not keep sending it, and must not
 * silently pretend it did.
 */
export function pickEffort(
  levels: readonly ModelEffort[],
  saved: ModelEffort | null,
): ModelEffort | null {
  return saved !== null && levels.includes(saved) ? saved : null
}

/** Label for one level, or for "whatever the provider does by default". */
export function effortLabel(level: ModelEffort | null): string {
  return level === null ? '默认' : LABELS[level]
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

/** The stored level, or null when nothing usable is stored. */
export function readEffort(): ModelEffort | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return MODEL_EFFORTS.find((level) => level === raw) ?? null
  } catch {
    // A profile that refuses storage only loses the shortcut.
    return null
  }
}

export function writeEffort(level: ModelEffort | null): void {
  try {
    if (level === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, level)
  } catch {
    // Same as above: the picker still works for this run.
  }
}

/**
 * The colour of one level as a CSS value, for parts that cannot take a class.
 *
 * The slider paints its filled half and its thumb from this, so the control and
 * the badge above it always agree.
 */
export function effortColor(level: ModelEffort | null): string {
  if (level === 'minimal' || level === 'low') return 'var(--color-effort-low)'
  if (level === 'medium') return 'var(--color-effort-mid)'
  if (level === 'high') return 'var(--color-effort-high)'
  if (level === 'xhigh' || level === 'max') return 'var(--color-effort-max)'
  return 'var(--color-border-strong)'
}
