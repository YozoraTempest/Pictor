import { z } from 'zod'

import type { UpdateCheckResult } from '../shared/desktop-bridge.js'
import { PictorError } from '../shared/errors.js'

type Fetch = typeof globalThis.fetch

interface UpdateServiceOptions {
  currentVersion: string
  platform: 'win32' | 'linux'
  arch: 'x64'
  distribution: 'windows' | 'ubuntu' | 'arch' | 'unsupported-linux'
  fetch: Fetch
  openExternal: (url: string) => Promise<void>
}

const RELEASE_API_URL = 'https://api.github.com/repos/YozoraTempest/Pictor/releases/latest'
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const githubReleaseSchema = z.object({
  tag_name: z.string().min(1),
  html_url: z.url(),
  published_at: z.iso.datetime().nullable(),
  assets: z.array(
    z.object({
      name: z.string().min(1),
      browser_download_url: z.url(),
    }),
  ),
})

interface ParsedVersion {
  core: [number, number, number]
  prerelease: string[] | null
}

function parseVersion(value: string): ParsedVersion {
  const match = VERSION_PATTERN.exec(value)
  if (!match) throw new Error(`Unsupported version: ${value}`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? null,
  }
}

function comparePrerelease(left: string[] | null, right: string[] | null): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference = leftVersion.core[index]! - rightVersion.core[index]!
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease)
}

function decodedPathSegments(url: URL): string[] | null {
  try {
    return url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
}

function isOfficialGithubUrl(url: URL): boolean {
  return url.origin === 'https://github.com' && !url.username && !url.password
}

function trustedReleaseUrl(value: string, tagName: string): string | null {
  const url = new URL(value)
  const segments = decodedPathSegments(url)
  return isOfficialGithubUrl(url) &&
    segments?.length === 5 &&
    segments[0] === 'YozoraTempest' &&
    segments[1] === 'Pictor' &&
    segments[2] === 'releases' &&
    segments[3] === 'tag' &&
    segments[4] === tagName
    ? url.toString()
    : null
}

type PackageKind = UpdateCheckResult['packageKind']

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expectedPackage(
  version: string,
  options: Pick<UpdateServiceOptions, 'platform' | 'arch' | 'distribution'>,
): { kind: Exclude<PackageKind, null>; pattern: RegExp } | null {
  if (options.arch !== 'x64') return null
  const escapedVersion = escapeRegExp(version)
  if (options.platform === 'win32') {
    return {
      kind: 'windows-nsis',
      pattern: new RegExp(`^Pictor-${escapedVersion}-windows-x64-setup\\.exe$`),
    }
  }
  if (options.distribution === 'ubuntu') {
    return {
      kind: 'ubuntu-deb',
      pattern: new RegExp(`^Pictor-${escapedVersion}-ubuntu-x64\\.deb$`),
    }
  }
  if (options.distribution === 'arch') {
    return {
      kind: 'arch-pacman',
      pattern: new RegExp(`^Pictor-${escapedVersion}-arch-x64\\.pacman$`),
    }
  }
  return null
}

function trustedPackageUrl(
  value: string,
  name: string,
  tagName: string,
  pattern: RegExp,
): string | null {
  if (!pattern.test(name)) return null
  const url = new URL(value)
  const segments = decodedPathSegments(url)
  return isOfficialGithubUrl(url) &&
    segments?.length === 6 &&
    segments[0] === 'YozoraTempest' &&
    segments[1] === 'Pictor' &&
    segments[2] === 'releases' &&
    segments[3] === 'download' &&
    segments[4] === tagName &&
    segments[5] === name
    ? url.toString()
    : null
}

export class UpdateService {
  private updateTarget: string | null = null

  constructor(private readonly options: UpdateServiceOptions) {}

  async check(): Promise<UpdateCheckResult> {
    this.updateTarget = null
    let response: Response
    try {
      response = await this.options.fetch(RELEASE_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new PictorError('internal', '无法连接 GitHub，请检查网络后重试')
    }
    if (!response.ok) {
      throw new PictorError('internal', `检查更新失败（GitHub HTTP ${response.status}）`)
    }

    let release: z.infer<typeof githubReleaseSchema>
    try {
      release = githubReleaseSchema.parse(await response.json())
    } catch {
      throw new PictorError('internal', 'GitHub 返回了无法识别的发布信息')
    }

    const releaseUrl = trustedReleaseUrl(release.html_url, release.tag_name)
    if (!releaseUrl) throw new PictorError('internal', 'GitHub 返回了不受信任的发布地址')

    let updateAvailable: boolean
    try {
      updateAvailable = compareVersions(release.tag_name, this.options.currentVersion) > 0
    } catch {
      throw new PictorError('internal', 'GitHub Release 使用了无法识别的版本号')
    }

    const latestVersion = release.tag_name.replace(/^v/, '')
    const expected = expectedPackage(latestVersion, this.options)
    const packageUrl = expected
      ? release.assets
          .map((asset) =>
            trustedPackageUrl(
              asset.browser_download_url,
              asset.name,
              release.tag_name,
              expected.pattern,
            ),
          )
          .find((url): url is string => url !== null)
      : undefined

    this.updateTarget = updateAvailable ? (packageUrl ?? releaseUrl) : null
    return {
      currentVersion: this.options.currentVersion,
      latestVersion,
      updateAvailable,
      packageAvailable: packageUrl !== undefined,
      packageKind: packageUrl ? (expected?.kind ?? null) : null,
      publishedAt: release.published_at,
    }
  }

  async openUpdate(): Promise<null> {
    if (!this.updateTarget) {
      throw new PictorError('invalid-input', '请先检查更新')
    }
    await this.options.openExternal(this.updateTarget)
    return null
  }
}
