import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsxCli = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs')
const creationTrigger = join(
  tmpdir(),
  'pictor-creation-mode',
  `${process.pid}-${randomBytes(8).toString('hex')}.reload`,
)

export function normalizeDevelopmentArguments(arguments_) {
  const forwarded = []
  let port = null
  let openBrowser = true

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--development') continue
    if (argument === '--no-open') {
      openBrowser = false
      continue
    }
    if (argument === '--port') {
      const value = arguments_[index + 1]
      if (value !== undefined) {
        port = Number(value)
        forwarded.push(argument, value)
        index += 1
        continue
      }
      port = Number.NaN
    }
    if (argument?.startsWith('--port=')) port = Number(argument.slice('--port='.length))
    forwarded.push(argument)
  }

  if (port === null) {
    port = 4310
    forwarded.push('--port', String(port))
  }
  return { forwarded, port, openBrowser }
}

export async function main(arguments_ = process.argv.slice(2)) {
  const request = normalizeDevelopmentArguments(arguments_)
  const launchToken = process.env.PICTOR_WEB_LAUNCH_TOKEN ?? randomBytes(24).toString('base64url')
  const sessionToken = process.env.PICTOR_WEB_SESSION_TOKEN ?? randomBytes(24).toString('base64url')
  const environment = {
    ...process.env,
    PICTOR_WEB_LAUNCH_TOKEN: launchToken,
    PICTOR_WEB_SESSION_TOKEN: sessionToken,
    PICTOR_WEB_CREATION_TRIGGER: creationTrigger,
  }

  await mkdir(dirname(creationTrigger), { recursive: true })
  await writeFile(creationTrigger, 'initial\n')
  const removeCreationTrigger = () => rmSync(creationTrigger, { force: true })
  process.once('exit', removeCreationTrigger)
  await run(process.execPath, ['scripts/build-plugins.mjs'], environment)

  const pluginWatcher = spawn(
    process.execPath,
    ['scripts/build-plugins.mjs', '--watch', '--skip-initial'],
    childOptions(environment),
  )
  const hostWatcher = spawn(
    process.execPath,
    [
      tsxCli,
      'watch',
      '--include',
      creationTrigger,
      'src/web-host/entry.ts',
      '--development',
      '--no-open',
      ...request.forwarded,
    ],
    childOptions(environment),
  )
  const children = [pluginWatcher, hostWatcher]
  let stopping = false

  const stop = async (signal = 'SIGTERM') => {
    if (stopping) return
    stopping = true
    for (const child of children) {
      if (child.exitCode === null) child.kill(signal)
    }
    await Promise.all(children.map(waitForExit))
    await rm(creationTrigger, { force: true })
    process.off('exit', removeCreationTrigger)
  }

  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))
  for (const child of children) {
    child.once('error', (error) => {
      globalThis.console.error('[dev:web] child process failed', error)
      void stop()
    })
    child.once('exit', (code, signal) => {
      if (stopping) return
      globalThis.console.error(`[dev:web] child process exited (${signal ?? code ?? 1})`)
      process.exitCode = code ?? 1
      void stop()
    })
  }

  if (request.openBrowser && Number.isInteger(request.port) && request.port > 0) {
    const launchUrl = `http://127.0.0.1:${request.port}/?token=${encodeURIComponent(launchToken)}`
    void waitUntilReachable(`http://127.0.0.1:${request.port}/`)
      .then(() => openExternalUrl(launchUrl))
      .catch((error) => {
        globalThis.console.warn('[dev:web] unable to open the browser automatically', error)
        globalThis.console.log(`Open this one-time URL: ${launchUrl}`)
      })
  }

  await Promise.all(children.map(waitForExit))
  return process.exitCode ?? 0
}

function childOptions(environment) {
  return { cwd: repositoryRoot, env: environment, stdio: 'inherit' }
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolvePromise) => child.once('exit', (code) => resolvePromise(code)))
}

async function run(executable, arguments_, environment) {
  const child = spawn(executable, arguments_, childOptions(environment))
  const code = await waitForExit(child)
  if (code !== 0) throw new Error(`${executable} ${arguments_.join(' ')} failed: ${code}`)
}

async function waitUntilReachable(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await request(url)
      return
    } catch {
      await delay(100)
    }
  }
  throw new Error('Pictor Web Host did not become reachable within 30 seconds')
}

function request(url) {
  return new Promise((resolvePromise, reject) => {
    const request = get(url, (response) => {
      response.resume()
      resolvePromise()
    })
    request.once('error', reject)
  })
}

function openExternalUrl(url) {
  const invocation =
    process.platform === 'win32'
      ? { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
      : { command: 'xdg-open', args: [url] }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
