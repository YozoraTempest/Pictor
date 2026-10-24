/**
 * Version part of the pinned npm spec.
 *
 * `@deepseek-ai/dsh@0.2.1-rc.2` → `0.2.1-rc.2`; anything without a version is
 * `null`, because a spec the app cannot read must not be reported as satisfied.
 */
export function pinnedVersionOf(spec: string): string | null {
  const at = spec.lastIndexOf('@')
  if (at <= 0) return null
  const version = spec.slice(at + 1).trim()
  return version.length === 0 ? null : version
}

export type VersionState = 'match' | 'mismatch' | 'unknown'

/**
 * How the runtime on this machine compares with the one this build pins.
 *
 * `unknown` is not a failure: a hand-pointed launcher (`PICTOR_DSH_BIN`) or a
 * checkout without a readable manifest simply cannot be compared, and pretending
 * otherwise would nag people who know what they are running.
 */
export function versionStateOf(expected: string | null, installed: string | null): VersionState {
  if (expected === null || installed === null) return 'unknown'
  return expected === installed ? 'match' : 'mismatch'
}
