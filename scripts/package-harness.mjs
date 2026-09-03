import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import process from 'node:process'

const DEFAULT_TIMEOUT_MS = 30_000

export function findPackagedPageTarget(targets) {
  return (
    targets.find((target) => target.type === 'page' && target.url === 'app://bundle/index.html') ??
    null
  )
}

export function windowsProcessTreeKillArguments(pid) {
  return ['/d', '/c', 'taskkill.exe', '/PID', String(pid), '/T', '/F']
}

export async function launchPackagedGui(executablePath, arguments_ = [], options = {}) {
  const port = await findFreePort()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const launcherPath = options.launcherPath ?? executablePath
  const launchArguments = [...arguments_, `--remote-debugging-port=${port}`]
  const environment = { ...process.env, ...options.env }
  if (launcherPath.toLowerCase().endsWith('.appimage')) {
    environment.APPIMAGE_EXTRACT_AND_RUN = '1'
  }

  const child = spawnGui(launcherPath, launchArguments, {
    cwd: options.cwd,
    env: environment,
  })
  const output = captureOutput(child)
  const exit = waitForExit(child)

  try {
    const pageTarget = await waitForPageTarget(port, child, output, timeoutMs)
    return {
      executablePath,
      launcherPath,
      pageTarget,
      pid: child.pid,
      close: async () => {
        await stopProcessTree(child, exit)
      },
    }
  } catch (error) {
    await stopProcessTree(child, exit).catch(() => undefined)
    throw error
  }
}

export async function runPackagedFrontend(launcherPath, arguments_, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const environment = { ...process.env, ...options.env }
  if (launcherPath.toLowerCase().endsWith('.appimage')) {
    environment.APPIMAGE_EXTRACT_AND_RUN = '1'
  }

  const isWindows = process.platform === 'win32'
  const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : launcherPath
  const commandArguments = isWindows
    ? [
        '/d',
        '/s',
        '/c',
        `call ${quoteForCmd(launcherPath)} ${arguments_.map(quoteForCmd).join(' ')}`,
      ]
    : arguments_
  const child = spawn(command, commandArguments, {
    cwd: options.cwd,
    detached: !isWindows,
    windowsVerbatimArguments: isWindows,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = captureOutput(child)
  const exit = waitForExit(child)
  let timedOut = false
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    stopProcessTree(child, exit).catch(() => undefined)
  }, timeoutMs)

  try {
    const result = await exit
    return { ...result, timedOut, ...output.read() }
  } finally {
    globalThis.clearTimeout(timer)
  }
}

export function assertCommand(result, label, expectedOutput, expectedExitCode = 0) {
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  if (
    result.timedOut ||
    result.exitCode !== expectedExitCode ||
    !combinedOutput.includes(expectedOutput)
  ) {
    throw new Error(`${label} failed: ${JSON.stringify(summarizeCommand(result))}`)
  }
}

export function summarizeCommand(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout.slice(0, 1_000),
    stderr: result.stderr.slice(0, 1_000),
  }
}

function spawnGui(launcherPath, arguments_, options) {
  if (process.platform === 'win32') {
    const command = process.env.ComSpec ?? 'cmd.exe'
    const commandLine = `call ${quoteForCmd(launcherPath)} ${arguments_.map(quoteForCmd).join(' ')}`
    return spawn(command, ['/d', '/s', '/c', commandLine], {
      ...options,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  return spawn(launcherPath, arguments_, {
    ...options,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function captureOutput(child) {
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  return {
    read: () => ({ stdout, stderr }),
  }
}

async function findFreePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()))
  })
  if (!address || typeof address === 'string') throw new Error('Failed to allocate a debug port')
  return address.port
}

async function waitForPageTarget(port, child, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Packaged GUI exited before it became ready: ${JSON.stringify({
          exitCode: child.exitCode,
          signal: child.signalCode,
          ...output.read(),
        })}`,
      )
    }
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const pageTarget = findPackagedPageTarget(await response.json())
        if (pageTarget) return pageTarget
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, 100))
  }
  throw new Error(
    `Packaged GUI did not expose app://bundle/index.html within ${timeoutMs}ms: ${JSON.stringify({
      lastError: lastError instanceof Error ? lastError.message : lastError,
      ...output.read(),
    })}`,
  )
}

async function stopProcessTree(child, exit) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync(process.env.ComSpec ?? 'cmd.exe', windowsProcessTreeKillArguments(child.pid), {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    signalProcessGroup(child.pid, 'SIGTERM')
  }

  if (await settlesWithin(exit, 5_000)) return
  if (process.platform === 'win32') {
    spawnSync(process.env.ComSpec ?? 'cmd.exe', windowsProcessTreeKillArguments(child.pid), {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    signalProcessGroup(child.pid, 'SIGKILL')
  }
  if (!(await settlesWithin(exit, 5_000))) {
    throw new Error(`Packaged process tree ${child.pid} did not exit`)
  }
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ exitCode: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => resolvePromise({ exitCode, signal }))
  })
}

async function settlesWithin(promise, timeoutMs) {
  return new Promise((resolvePromise) => {
    const timer = globalThis.setTimeout(() => resolvePromise(false), timeoutMs)
    promise.then(
      () => {
        globalThis.clearTimeout(timer)
        resolvePromise(true)
      },
      () => {
        globalThis.clearTimeout(timer)
        resolvePromise(true)
      },
    )
  })
}

function quoteForCmd(argument) {
  return `"${String(argument).replaceAll('"', '\\"')}"`
}
