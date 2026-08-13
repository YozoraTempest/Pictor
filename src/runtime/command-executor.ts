import { spawn } from 'node:child_process'

const OUTPUT_LIMIT = 100_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const TERMINATION_GRACE_MS = 250

export interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface CommandExecutor {
  execute(command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult>
}

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= OUTPUT_LIMIT) return current
  const next = current + chunk.toString('utf8')
  return next.length > OUTPUT_LIMIT ? `${next.slice(0, OUTPUT_LIMIT)}\n[输出已截断]` : next
}

export class BashCommandExecutor implements CommandExecutor {
  constructor(
    private readonly executablePath: string | null,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async execute(command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult> {
    signal?.throwIfAborted()
    if (!this.executablePath) {
      throw new Error('Bash 不可用；请安装 Bash 或设置 PICTOR_BASH_PATH 后重启 Pictor')
    }

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(this.executablePath!, ['--noprofile', '--norc', '-lc', command], {
        cwd,
        env: process.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let termination: Promise<void> | null = null
      const terminate = (): Promise<void> => {
        if (termination) return termination
        if (!child.pid) return Promise.resolve()
        if (process.platform === 'win32') {
          termination = new Promise<void>((finish) => {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            })
            killer.once('error', () => {
              child.kill()
              finish()
            })
            killer.once('close', () => finish())
          })
          return termination
        }

        const processGroupId = -child.pid
        try {
          process.kill(processGroupId, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }

        termination = new Promise<void>((finish) => {
          const forceKill = setTimeout(() => {
            try {
              process.kill(processGroupId, 'SIGKILL')
            } catch {
              // The process group has already exited.
            }
            finish()
          }, TERMINATION_GRACE_MS)
          forceKill.unref()
        })
        return termination
      }
      const abort = () => {
        void terminate()
      }
      const timeout = setTimeout(() => {
        timedOut = true
        void terminate()
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
        void (async () => {
          if (termination) await termination
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
        })().catch(reject)
      })
    })
  }
}
