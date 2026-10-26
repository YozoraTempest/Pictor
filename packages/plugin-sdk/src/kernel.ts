/**
 * Contribution point `kernel`.
 *
 * A plugin can bring an agent kernel: the module named here is a cordis plugin that
 * provides exactly one `kernel.<id>` service, and Pictor mounts it the same way it
 * mounts its own two. This is what makes "add a kernel" one thing rather than two —
 * the same package can contribute panels and a kernel, and installing it does both.
 *
 * The payload stays data: a relative entry path and an optional display name. Loading
 * the module is the kernel host's job, so this package never imports plugin code.
 */
export interface KernelContribution {
  /** Entry module relative to the plugin root; the cordis plugin lives here. */
  main: string
  /** Display name for the picker; the kernel may still report its own. */
  label?: string
}

export interface KernelContributionFailure {
  reason: string
}

export class KernelContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KernelContributionError'
  }
}

/** Menu labels are short by design; anything longer is not a name. */
const MAX_LABEL = 60

/** Validates one `kernel` contribution at the boundary. */
export function parseKernelContribution(value: unknown): KernelContribution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KernelContributionError('kernel contribution must be an object')
  }

  const record = value as Record<string, unknown>
  const main = record.main
  if (typeof main !== 'string' || main.trim().length === 0) {
    throw new KernelContributionError('kernel.main must be a non-empty string')
  }

  // The entry is joined onto the plugin root at mount time, so it must not climb out.
  const normalized = main.trim().replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new KernelContributionError(`kernel.main must stay inside the plugin root: ${main}`)
  }

  const label = record.label
  if (label !== undefined) {
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new KernelContributionError('kernel.label must be a non-empty string')
    }
    if (label.trim().length > MAX_LABEL) {
      throw new KernelContributionError(`kernel.label is longer than ${String(MAX_LABEL)}`)
    }
  }

  return {
    main: normalized,
    ...(label === undefined ? {} : { label: (label as string).trim() }),
  }
}

/**
 * Validates every `kernel` contribution a plugin declared.
 *
 * Failures are returned rather than thrown so one bad payload cannot hide the rest —
 * the same rule the other contribution points follow.
 */
export function parseKernelContributions(values: readonly unknown[]): {
  kernels: KernelContribution[]
  failures: KernelContributionFailure[]
} {
  const kernels: KernelContribution[] = []
  const failures: KernelContributionFailure[] = []

  for (const value of values) {
    try {
      kernels.push(parseKernelContribution(value))
    } catch (error) {
      failures.push({ reason: (error as Error).message })
    }
  }

  return { kernels, failures }
}
