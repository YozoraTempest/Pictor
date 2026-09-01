import { chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import process from 'node:process'

export async function launchPackagedGui(executablePath, arguments_, options = {}) {
  const port = await findFreePort()
  const windowsBatchLauncher =
    process.platform === 'win32' && executablePath.toLowerCase().endsWith('.cmd')
  const command = windowsBatchLauncher ? (process.env.ComSpec ?? 'cmd.exe') : executablePath
  const packagedGuiArguments = [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    ...(process.platform === 'win32' ? ['--disable-gpu'] : []),
    ...arguments_,
  ]
  const commandArguments = windowsBatchLauncher
    ? [
        '/d',
        '/s',
        '/c',
        `call ${quoteForCmd(executablePath)} ${packagedGuiArguments.map(quoteForCmd).join(' ')}`,
      ]
    : packagedGuiArguments
  const child = spawn(command, commandArguments, {
    cwd: options.cwd,
    shell: windowsBatchLauncher ? false : (options.shell ?? false),
    windowsVerbatimArguments: windowsBatchLauncher,
    env: {
      ...(options.env ?? process.env),
      ...(executablePath.toLowerCase().endsWith('.appimage')
        ? { APPIMAGE_EXTRACT_AND_RUN: '1' }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let cdpTargets = []
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    await waitForCdp(
      port,
      child,
      () => ({ stdout, stderr, cdpTargets }),
      (targets) => {
        cdpTargets = targets
      },
    )
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: 120_000,
    })
    const applicationPid =
      (await findProcessByArgument(`--remote-debugging-port=${port}`)) ?? child.pid
    return {
      firstWindow: () => firstPage(browser, () => ({ stdout, stderr })),
      close: async () => {
        await withTimeout(
          browser.close().catch(() => undefined),
          2_000,
        )
        await stopProcess(applicationPid)
        if (child.pid !== applicationPid) await stopProcess(child.pid)
        if (process.platform === 'linux') {
          for (const pid of await findProcessesByArgument(`--remote-debugging-port=${port}`)) {
            await stopProcess(pid)
          }
        }
        await waitForExit(child, 2_000)
      },
    }
  } catch (error) {
    const output = JSON.stringify({ stdout, stderr, cdpTargets })
    await stopProcess(child.pid)
    await waitForExit(child, 2_000)
    throw new Error(`${String(error)}\nPackaged GUI output: ${output}`, { cause: error })
  }
}

async function findFreePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolvePromise) => server.close(resolvePromise))
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a CDP port')
  return address.port
}

async function waitForCdp(port, child, readOutput, updateTargets) {
  const deadline = Date.now() + 120_000
  let browserReady = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged GUI exited before CDP became ready: ${JSON.stringify(readOutput())}`,
      )
    }
    try {
      if (!browserReady) {
        const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/version`)
        browserReady = response.ok
      }
      if (browserReady) {
        const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
        if (response.ok) {
          const targets = await response.json()
          if (Array.isArray(targets)) updateTargets(targets)
          if (Array.isArray(targets) && targets.some((target) => target?.type === 'page')) return
        }
      }
    } catch {
      // Electron may need a few cycles to bind the port.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  }
  throw new Error(`Packaged GUI CDP did not become ready: ${JSON.stringify(readOutput())}`)
}

async function findProcessByArgument(argument) {
  return (await findProcessesByArgument(argument))[0] ?? null
}

async function findProcessesByArgument(argument) {
  if (process.platform !== 'linux') return []
  const entries = await readdir('/proc', { withFileTypes: true })
  const pids = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    if (pid === process.pid) continue
    const commandLine = await readFile(`/proc/${entry.name}/cmdline`, 'utf8').catch(() => '')
    if (commandLine.includes(argument)) pids.push(pid)
  }
  return pids
}

async function stopProcess(pid) {
  if (!pid || pid === process.pid) return
  await signalProcess(pid, 'TERM')
  await waitForPidExit(pid, 2_000)
  try {
    process.kill(pid, 0)
  } catch {
    return
  }
  await signalProcess(pid, 'KILL')
}

async function signalProcess(pid, signal) {
  const nodeSignal = signal === 'TERM' ? 'SIGTERM' : 'SIGKILL'
  if (process.platform === 'win32') {
    const result = spawnSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/c', 'taskkill.exe', '/PID', String(pid), '/T', '/F'],
      { stdio: 'ignore' },
    )
    if (!result.error && result.status === 0) return
  }
  if (process.platform !== 'win32') {
    // The AppImage runtime can reparent the extracted Electron process to the
    // workspace daemon.  /bin/kill reliably signals that exact PID as well as
    // a normal child process; it never matches by executable name.  Use a
    // synchronous, bounded system call so a reparented process cannot leave
    // the test cleanup waiting on an inherited child process.
    const result = spawnSync('/bin/kill', [`-${signal}`, String(pid)], { stdio: 'ignore' })
    if (!result.error && result.status === 0) return
  }
  try {
    process.kill(pid, nodeSignal)
  } catch {
    // The process exited between the discovery and the signal.
  }
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
  }
}

async function withTimeout(promise, timeoutMs) {
  await Promise.race([promise, new Promise((resolve) => globalThis.setTimeout(resolve, timeoutMs))])
}

async function firstPage(browser, readOutput) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())[0]
    if (page) return page
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  }
  const pages = browser.contexts().flatMap((context) => context.pages())
  throw new Error(
    `Packaged GUI did not create a renderer page: ${JSON.stringify({
      pageCount: pages.length,
      pages: pages.map((page) => ({ url: page.url() })),
      ...readOutput(),
    })}`,
  )
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return withTimeout(new Promise((resolve) => child.once('exit', resolve)), timeoutMs)
}

function quoteForCmd(argument) {
  return `"${String(argument).replaceAll('"', '\\"')}"`
}
