import { readFile } from 'node:fs/promises'

import type { AppInfo } from '../modules/updater/shared.js'

type DesktopDistribution = AppInfo['distribution']

function unquote(value: string): string {
  if (value.length < 2) return value
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\([\\"$`])/g, '$1')
  }
  return value
}

export interface OsReleaseIdentity {
  id: string | null
  idLike: string[]
  versionId: string | null
}

export function parseOsRelease(content: string): OsReleaseIdentity {
  const values = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue
    values.set(key, unquote(line.slice(separator + 1).trim()))
  }
  const id = values.get('ID')?.toLocaleLowerCase('en-US') ?? null
  const idLike = (values.get('ID_LIKE') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => value.toLocaleLowerCase('en-US'))
  const versionId = values.get('VERSION_ID') ?? null
  return { id, idLike, versionId }
}

export function classifyLinuxDistribution(identity: OsReleaseIdentity): DesktopDistribution {
  if (identity.id === 'arch') return 'arch'
  return 'unsupported-linux'
}

export async function detectDesktopDistribution(
  platform: AppInfo['platform'] = process.platform === 'win32' ? 'win32' : 'linux',
  loadOsRelease: () => Promise<string> = () => readFile('/etc/os-release', 'utf8'),
): Promise<DesktopDistribution> {
  if (platform === 'win32') return 'windows'
  try {
    return classifyLinuxDistribution(parseOsRelease(await loadOsRelease()))
  } catch {
    return 'unsupported-linux'
  }
}
