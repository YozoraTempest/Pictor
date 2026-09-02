import { _electron as electron, chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const PACKAGED_GUI_LAUNCH_MODES = Object.freeze({
  ELECTRON: 'electron',
  CDP: 'cdp',
  WINDOWS_LAUNCHER_HTTP: 'windows-launcher-http',
})

const PACKAGED_PAGE_URL = 'app://bundle/index.html'
const electronRuntimeDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/electron/dist',
)
const playwrightElectronLoader = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/playwright-core/lib/server/electron/loader.js',
)

export function selectPackagedGuiLaunchMode(executablePath, platform = process.platform) {
  const normalizedPath = executablePath.toLowerCase()
  if (platform === 'win32' && normalizedPath.endsWith('.exe')) {
    return PACKAGED_GUI_LAUNCH_MODES.ELECTRON
  }
  if (platform === 'win32' && normalizedPath.endsWith('.cmd')) {
    return PACKAGED_GUI_LAUNCH_MODES.WINDOWS_LAUNCHER_HTTP
  }
  return PACKAGED_GUI_LAUNCH_MODES.CDP
}

export function findWindowsPackagedPageTarget(targets) {
  return (
    targets.find((target) => target?.type === 'page' && target?.url === PACKAGED_PAGE_URL) ?? null
  )
}

export function windowsProcessTreeKillArguments(pid) {
  return ['/d', '/c', 'taskkill.exe', '/PID', String(pid), '/T', '/F']
}

export async function launchPackagedGui(executablePath, arguments_, options = {}) {
  const launchMode = selectPackagedGuiLaunchMode(executablePath)
  if (launchMode === PACKAGED_GUI_LAUNCH_MODES.ELECTRON) {
    return launchPackagedGuiWithElectron(executablePath, arguments_, options)
  }
  if (launchMode === PACKAGED_GUI_LAUNCH_MODES.WINDOWS_LAUNCHER_HTTP) {
    throw new Error('Windows pictor.cmd GUI verification must use launchWindowsLauncherGui()')
  }
  return launchPackagedGuiOverCdp(executablePath, arguments_, options)
}

async function launchPackagedGuiWithElectron(executablePath, arguments_, options) {
  const playwrightRuntime = await stagePlaywrightRuntime(executablePath)
  try {
    const electronApp = await electron.launch({
      executablePath: playwrightRuntime.executable,
      args: [
        '--no-sandbox',
        '-r',
        playwrightElectronLoader,
        join(playwrightRuntime.directory, 'resources', 'app.asar'),
        ...arguments_,
      ],
      cwd: options.cwd,
      timeout: 30_000,
      env: {
        ...(options.env ?? process.env),
        PICTOR_PACKAGED: '1',
        PICTOR_INSTALLATION_ROOT: playwrightRuntime.directory,
        PICTOR_PACKAGE_ROOT: join(playwrightRuntime.directory, 'resources', 'app.asar'),
        PICTOR_BUNDLED_PLUGINS_DIRECTORY: join(
          playwrightRuntime.directory,
          'resources',
          'bundled-plugins',
        ),
        PICTOR_FRONTEND: 'gui',
      },
    })
    const originalClose = electronApp.close.bind(electronApp)
    let closePromise
    electronApp.close = () => {
      closePromise ??= (async () => {
        try {
          await originalClose()
        } finally {
          await rm(playwrightRuntime.directory, { recursive: true, force: true })
        }
      })()
      return closePromise
    }
    return electronApp
  } catch (error) {
    await rm(playwrightRuntime.directory, { recursive: true, force: true })
    throw error
  }
}

async function stagePlaywrightRuntime(executablePath) {
  const directory = await mkdtemp(join(dirname(executablePath), '.pictor-playwright-'))
  try {
    await cloneFileTree(electronRuntimeDirectory, directory)
    const runtimeExecutable = await findRuntimeExecutable(directory)
    const executable = join(directory, 'Pictor.exe')
    await linkOrCopy(runtimeExecutable, executable)
    await rm(runtimeExecutable, { force: true })

    const sourceResources = join(dirname(executablePath), 'resources')
    const targetResources = join(directory, 'resources')
    await rm(join(targetResources, 'app.asar'), { force: true })
    await cloneFileTree(join(sourceResources, 'app.asar'), join(targetResources, 'app.asar'))
    const sourceUnpacked = join(sourceResources, 'app.asar.unpacked')
    await rm(join(targetResources, 'app.asar.unpacked'), { recursive: true, force: true })
    if (await pathExists(sourceUnpacked)) {
      await cloneFileTree(sourceUnpacked, join(targetResources, 'app.asar.unpacked'))
    }
    await rm(join(targetResources, 'bundled-plugins'), { recursive: true, force: true })
    await cloneFileTree(
      join(sourceResources, 'bundled-plugins'),
      join(targetResources, 'bundled-plugins'),
    )
    return { directory, executable }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function findRuntimeExecutable(directory) {
  for (const name of ['electron.exe', 'electron']) {
    const candidate = join(directory, name)
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate
  }
  throw new Error(`Electron runtime executable is missing from ${directory}`)
}

async function pathExists(path) {
  return access(path).then(
    () => true,
    () => false,
  )
}

async function cloneFileTree(source, target) {
  const metadata = await lstat(source)
  if (metadata.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source)) {
      await cloneFileTree(join(source, entry), join(target, entry))
    }
    return
  }
  await mkdir(dirname(target), { recursive: true })
  await linkOrCopy(source, target)
}

async function linkOrCopy(source, target) {
  try {
    await link(source, target)
  } catch {
    await copyFile(source, target)
  }
}

export async function launchWindowsLauncherGui(launcherPath, arguments_, options = {}) {
  if (
    selectPackagedGuiLaunchMode(launcherPath) !== PACKAGED_GUI_LAUNCH_MODES.WINDOWS_LAUNCHER_HTTP
  ) {
    throw new Error('launchWindowsLauncherGui() requires a Windows .cmd launcher')
  }

  const port = await findFreePort()
  const command = process.env.ComSpec ?? 'cmd.exe'
  const packagedGuiArguments = [`--remote-debugging-port=${port}`, '--no-sandbox', ...arguments_]
  const commandArguments = [
    '/d',
    '/s',
    '/c',
    `call ${quoteForCmd(launcherPath)} ${packagedGuiArguments.map(quoteForCmd).join(' ')}`,
  ]
  const child = spawn(command, commandArguments, {
    cwd: options.cwd,
    windowsVerbatimArguments: true,
    env: {
      ...(options.env ?? process.env),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    await waitForWindowsPageTarget(port, child, () => ({ stdout, stderr }))
    if (child.exitCode !== null) {
      throw new Error(`Windows launcher exited after creating its page target: ${child.exitCode}`)
    }
    const confirmedPageTarget = findWindowsPackagedPageTarget(await readJsonTargets(port))
    if (!confirmedPageTarget) {
      throw new Error('Windows launcher page target disappeared before cleanup')
    }
    let closed = false
    return {
      port,
      pid: child.pid,
      pageTarget: confirmedPageTarget,
      close: async () => {
        if (closed) return
        closed = true
        await stopProcessTree(child.pid)
        await waitForExit(child, 2_000)
      },
    }
  } catch (error) {
    await stopProcessTree(child.pid)
    await waitForExit(child, 2_000)
    throw error
  }
}

async function launchPackagedGuiOverCdp(executablePath, arguments_, options) {
  const port = await findFreePort()
  const packagedGuiArguments = [`--remote-debugging-port=${port}`, '--no-sandbox', ...arguments_]
  const child = spawn(executablePath, packagedGuiArguments, {
    cwd: options.cwd,
    shell: options.shell ?? false,
    windowsVerbatimArguments: false,
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
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    await waitForCdp(port, child, () => ({ stdout, stderr }))
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const applicationPid =
      (await findProcessByArgument(`--remote-debugging-port=${port}`)) ?? child.pid
    return {
      firstWindow: () => firstPage(browser),
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
    await stopProcess(child.pid)
    await waitForExit(child, 2_000)
    throw error
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

async function waitForCdp(port, child, readOutput) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged GUI exited before CDP became ready: ${JSON.stringify(readOutput())}`,
      )
    }
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Electron may need a few cycles to bind the port.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  }
  throw new Error(`Packaged GUI CDP did not become ready: ${JSON.stringify(readOutput())}`)
}

async function waitForWindowsPageTarget(port, child, readOutput) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Windows launcher exited before its page target was ready: ${JSON.stringify(readOutput())}`,
      )
    }
    const target = findWindowsPackagedPageTarget(await readJsonTargets(port))
    if (target) return target
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  }
  throw new Error(
    `Windows launcher page target did not become ready: ${JSON.stringify(readOutput())}`,
  )
}

async function readJsonTargets(port) {
  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) return []
    const targets = await response.json()
    return Array.isArray(targets) ? targets : []
  } catch {
    return []
  }
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

async function stopProcessTree(pid) {
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
      windowsProcessTreeKillArguments(pid),
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
  let timer
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = globalThis.setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer) globalThis.clearTimeout(timer)
  }
}

async function firstPage(browser) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())[0]
    if (page) return page
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  }
  throw new Error('Packaged GUI did not create a renderer page')
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return withTimeout(new Promise((resolve) => child.once('exit', resolve)), timeoutMs)
}

function quoteForCmd(argument) {
  return `"${String(argument).replaceAll('"', '\\"')}"`
}
