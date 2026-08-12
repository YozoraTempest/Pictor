import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, delimiter, dirname, join } from 'node:path'

const OUTPUT_LIMIT = 100_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

export interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface CommandExecutor {
  execute(command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult>
}

async function findGitBash(): Promise<string> {
  const pathCandidates = (process.env.Path ?? process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => {
      if (basename(directory).toLocaleLowerCase('en-US') !== 'cmd') return []
      const gitRoot = dirname(directory)
      return [join(gitRoot, 'bin', 'bash.exe'), join(gitRoot, 'usr', 'bin', 'bash.exe')]
    })
  const candidates = [
    process.env.PICTOR_BASH_PATH,
    ...pathCandidates,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue through the fixed Git for Windows locations.
    }
  }
  throw new Error('未找到 Git Bash；请安装 Git for Windows 或设置 PICTOR_BASH_PATH')
}

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= OUTPUT_LIMIT) return current
  const next = current + chunk.toString('utf8')
  return next.length > OUTPUT_LIMIT ? `${next.slice(0, OUTPUT_LIMIT)}\n[输出已截断]` : next
}

export class GitBashCommandExecutor implements CommandExecutor {
  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async execute(command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult> {
    signal?.throwIfAborted()
    const bash = await findGitBash()

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(bash, ['--noprofile', '--norc', '-lc', command], {
        cwd,
        env: process.env,
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const terminate = () => {
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.once('error', () => child.kill())
          return
        }
        child.kill()
      }
      const abort = () => terminate()
      const timeout = setTimeout(() => {
        timedOut = true
        terminate()
      }, this.timeoutMs)
      const cleanup = () => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
      signal?.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk)
      })
      child.on('error', (error) => {
        cleanup()
        reject(error)
      })
      child.on('close', (exitCode) => {
        cleanup()
        if (timedOut) {
          reject(new Error(`命令执行超时（${Math.max(1, Math.ceil(this.timeoutMs / 1000))} 秒）`))
          return
        }
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        resolve({ exitCode, stdout, stderr })
      })
    })
  }
}
