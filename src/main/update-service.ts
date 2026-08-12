import { z } from 'zod'

import type { UpdateCheckResult } from '../shared/desktop-bridge.js'
import { PictorError } from '../shared/errors.js'

type Fetch = typeof globalThis.fetch

interface UpdateServiceOptions {
  currentVersion: string
  fetch: Fetch
  openExternal: (url: string) => Promise<void>
}

const RELEASE_API_URL = 'https://api.github.com/repos/YozoraTempest/Pictor/releases/latest'
const RELEASE_PATH_PREFIX = '/YozoraTempest/Pictor/releases/'
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

function trustedReleaseUrl(value: string): string | null {
  const url = new URL(value)
  return url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.pathname.startsWith(RELEASE_PATH_PREFIX)
    ? url.toString()
    : null
}

function trustedInstallerUrl(value: string, name: string): string | null {
  if (!/^Pictor-.+-windows-x64-setup\.exe$/.test(name)) return null
  const url = trustedReleaseUrl(value)
  return url && new URL(url).pathname.includes('/download/') ? url : null
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

    const releaseUrl = trustedReleaseUrl(release.html_url)
    if (!releaseUrl) throw new PictorError('internal', 'GitHub 返回了不受信任的发布地址')

    let updateAvailable: boolean
    try {
      updateAvailable = compareVersions(release.tag_name, this.options.currentVersion) > 0
    } catch {
      throw new PictorError('internal', 'GitHub Release 使用了无法识别的版本号')
    }

    const installerUrl = release.assets
      .map((asset) => trustedInstallerUrl(asset.browser_download_url, asset.name))
      .find((url): url is string => url !== null)

    this.updateTarget = updateAvailable ? (installerUrl ?? releaseUrl) : null
    return {
      currentVersion: this.options.currentVersion,
      latestVersion: release.tag_name.replace(/^v/, ''),
      updateAvailable,
      installerAvailable: installerUrl !== undefined,
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
