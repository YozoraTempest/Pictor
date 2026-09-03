import { z } from 'zod'

import type { AppInfo } from '../../shared/app-info.js'
import { PictorError } from '../../shared/errors.js'
import type { UpdateChannel, UpdateCheckResult } from './shared.js'

type Fetch = typeof globalThis.fetch

export interface UpdateServiceOptions {
  appInfo: AppInfo
  fetch: Fetch
  openExternal: (url: string) => Promise<void>
}

const STABLE_RELEASE_API_URL = 'https://api.github.com/repos/YozoraTempest/Pictor/releases/latest'
const NIGHTLY_RELEASE_API_URL =
  'https://api.github.com/repos/YozoraTempest/Pictor/releases/tags/nightly'
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const FILE_VERSION_PATTERN = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?)'
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

const githubReleaseSchema = z.object({
  tag_name: z.string().min(1),
  target_commitish: z.string().min(1),
  html_url: z.url(),
  prerelease: z.boolean(),
  published_at: z.iso.datetime().nullable(),
  assets: z.array(
    z.object({
      name: z.string().min(1),
      browser_download_url: z.url(),
    }),
  ),
})

type GithubRelease = z.infer<typeof githubReleaseSchema>

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

function packageDescriptor(
  versionPattern: string,
  appInfo: AppInfo,
): { kind: Exclude<PackageKind, null>; pattern: RegExp } {
  if (appInfo.platform === 'win32') {
    return {
      kind: 'windows-nsis',
      pattern: new RegExp(`^Pictor-${versionPattern}-windows-x64-setup\\.exe$`),
    }
  }
  if (appInfo.distribution === 'arch') {
    return {
      kind: 'arch-pacman',
      pattern: new RegExp(`^Pictor-${versionPattern}-arch-x64\\.pacman$`),
    }
  }
  return {
    kind: 'linux-appimage',
    pattern: new RegExp(`^Pictor-${versionPattern}-linux-x64\\.AppImage$`),
  }
}

function trustedPackageUrl(value: string, name: string, tagName: string): string | null {
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

function stablePackage(
  release: GithubRelease,
  version: string,
  appInfo: AppInfo,
): { kind: Exclude<PackageKind, null>; url: string } | null {
  const descriptor = packageDescriptor(escapeRegExp(version), appInfo)
  const asset = release.assets.find(({ name }) => descriptor.pattern.test(name))
  if (!asset) return null
  const url = trustedPackageUrl(asset.browser_download_url, asset.name, release.tag_name)
  return url ? { kind: descriptor.kind, url } : null
}

function nightlyPackage(
  release: GithubRelease,
  appInfo: AppInfo,
): { kind: Exclude<PackageKind, null>; url: string; version: string } | null {
  const descriptor = packageDescriptor(FILE_VERSION_PATTERN, appInfo)
  const packages = release.assets.flatMap((asset) => {
    const match = descriptor.pattern.exec(asset.name)
    const version = match?.[1]
    if (!version) return []
    try {
      parseVersion(version)
    } catch {
      return []
    }
    const url = trustedPackageUrl(asset.browser_download_url, asset.name, release.tag_name)
    return url ? [{ kind: descriptor.kind, url, version }] : []
  })
  if (packages.length > 1) {
    throw new PictorError('internal', 'Nightly 包含多个匹配当前平台的发行包')
  }
  return packages[0] ?? null
}

export class UpdateService {
  private updateTarget: string | null = null

  constructor(private readonly options: UpdateServiceOptions) {}

  reset(): void {
    this.updateTarget = null
  }

  async check(channel: UpdateChannel): Promise<UpdateCheckResult> {
    this.reset()
    const release = await this.fetchRelease(
      channel === 'stable' ? STABLE_RELEASE_API_URL : NIGHTLY_RELEASE_API_URL,
    )
    if (channel === 'nightly') this.assertNightlyRelease(release)
    const releaseUrl = trustedReleaseUrl(release.html_url, release.tag_name)
    if (!releaseUrl) throw new PictorError('internal', 'GitHub 返回了不受信任的发布地址')
    return channel === 'stable'
      ? this.checkStable(release, releaseUrl)
      : this.checkNightly(release, releaseUrl)
  }

  async openUpdate(): Promise<null> {
    if (!this.updateTarget) throw new PictorError('invalid-input', '请先检查更新')
    await this.options.openExternal(this.updateTarget)
    return null
  }

  private async fetchRelease(url: string): Promise<GithubRelease> {
    let response: Response
    try {
      response = await this.options.fetch(url, {
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
    try {
      return githubReleaseSchema.parse(await response.json())
    } catch {
      throw new PictorError('internal', 'GitHub 返回了无法识别的发布信息')
    }
  }

  private checkStable(release: GithubRelease, releaseUrl: string): UpdateCheckResult {
    if (release.prerelease) {
      throw new PictorError('internal', 'GitHub Latest 返回了预发布版本')
    }
    let updateAvailable: boolean
    try {
      updateAvailable = compareVersions(release.tag_name, this.options.appInfo.version) > 0
    } catch {
      throw new PictorError('internal', 'GitHub Release 使用了无法识别的版本号')
    }
    const latestVersion = release.tag_name.replace(/^v/, '')
    const packageTarget = stablePackage(release, latestVersion, this.options.appInfo)
    this.updateTarget = updateAvailable ? (packageTarget?.url ?? releaseUrl) : null
    return {
      channel: 'stable',
      currentVersion: this.options.appInfo.version,
      latestVersion,
      latestCommit: null,
      updateAvailable,
      packageAvailable: packageTarget !== null,
      packageKind: packageTarget?.kind ?? null,
      publishedAt: release.published_at,
    }
  }

  private checkNightly(release: GithubRelease, releaseUrl: string): UpdateCheckResult {
    const packageTarget = nightlyPackage(release, this.options.appInfo)
    const updateAvailable =
      this.options.appInfo.buildChannel !== 'nightly' ||
      this.options.appInfo.sourceCommit !== release.target_commitish
    this.updateTarget = updateAvailable ? (packageTarget?.url ?? releaseUrl) : null
    return {
      channel: 'nightly',
      currentVersion: this.options.appInfo.version,
      latestVersion: packageTarget?.version ?? null,
      latestCommit: release.target_commitish,
      updateAvailable,
      packageAvailable: packageTarget !== null,
      packageKind: packageTarget?.kind ?? null,
      publishedAt: release.published_at,
    }
  }

  private assertNightlyRelease(release: GithubRelease): void {
    if (
      release.tag_name !== 'nightly' ||
      !release.prerelease ||
      !COMMIT_PATTERN.test(release.target_commitish)
    ) {
      throw new PictorError('internal', 'GitHub 返回了无法识别的 Nightly 发布信息')
    }
  }
}
