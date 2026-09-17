import { spawn, type SpawnOptions } from 'node:child_process'

export interface ExternalProcess {
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'spawn', listener: () => void): unknown
  unref(): void
}

export type ExternalProcessFactory = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ExternalProcess

export function openExternalUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
  processFactory: ExternalProcessFactory = spawn,
): Promise<void> {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return Promise.reject(new Error(`Unsupported external URL protocol: ${target.protocol}`))
  }

  const invocation =
    platform === 'win32'
      ? { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', target.toString()] }
      : { command: 'xdg-open', args: [target.toString()] }
  return new Promise<void>((resolve, reject) => {
    const child = processFactory(invocation.command, invocation.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
