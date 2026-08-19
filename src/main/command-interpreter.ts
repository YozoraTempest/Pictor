import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'

import type { AppInfo } from '../modules/updater/shared.js'

type SupportedPlatform = AppInfo['platform']

interface DiscoveryOptions {
  platform?: SupportedPlatform
  env?: NodeJS.ProcessEnv
  cwd?: string
  resolveExecutable?: (path: string) => Promise<string | null>
}

export interface CommandInterpreterDiscovery {
  executablePath: string | null
  status: AppInfo['commandInterpreter']
}

async function resolveExecutableFile(path: string): Promise<string | null> {
  try {
    const canonicalPath = await realpath(path)
    const metadata = await stat(canonicalPath)
    if (!metadata.isFile()) return null
    await access(canonicalPath, constants.X_OK)
    return canonicalPath
  } catch {
    return null
  }
}

function candidates(platform: SupportedPlatform, env: NodeJS.ProcessEnv): string[] {
  const override = env.PICTOR_BASH_PATH
  if (platform === 'linux') {
    const fromPath = (env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, 'bash'))
    return [override, ...fromPath, '/bin/bash', '/usr/bin/bash'].filter(
      (candidate): candidate is string => Boolean(candidate),
    )
  }

  const fromGitCmd = (env.Path ?? env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => {
      if (basename(directory).toLocaleLowerCase('en-US') !== 'cmd') return []
      const gitRoot = dirname(directory)
      return [join(gitRoot, 'bin', 'bash.exe'), join(gitRoot, 'usr', 'bin', 'bash.exe')]
    })
  return [
    override,
    ...fromGitCmd,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter((candidate): candidate is string => Boolean(candidate))
}

export async function discoverCommandInterpreter(
  options: DiscoveryOptions = {},
): Promise<CommandInterpreterDiscovery> {
  const platform = options.platform ?? (process.platform === 'win32' ? 'win32' : 'linux')
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const resolveCandidate = options.resolveExecutable ?? resolveExecutableFile
  const absoluteCandidates = candidates(platform, env).map((candidate) =>
    isAbsolute(candidate) ? candidate : resolve(cwd, candidate),
  )
  for (const candidate of [...new Set(absoluteCandidates)]) {
    const executablePath = await resolveCandidate(candidate)
    if (executablePath) {
      return {
        executablePath,
        status: { kind: 'bash', available: true, message: null },
      }
    }
  }

  return {
    executablePath: null,
    status: {
      kind: 'bash',
      available: false,
      message:
        platform === 'linux'
          ? '未找到 Bash；命令工具不可用。请安装 Bash 或设置 PICTOR_BASH_PATH。'
          : '未找到 Git Bash；命令工具不可用。请安装 Git for Windows 或设置 PICTOR_BASH_PATH。',
    },
  }
}
