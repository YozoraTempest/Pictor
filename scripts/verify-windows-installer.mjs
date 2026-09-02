import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { launchPackagedGui } from './packaged-gui.mjs'

const execute = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const installer = resolve(
  process.env.PICTOR_WINDOWS_INSTALLER ??
    resolve(repositoryRoot, 'dist', `Pictor-${packageMetadata.version}-windows-x64-setup.exe`),
)
const testRoot = await mkdtemp(join(process.env.TEMP ?? tmpdir(), 'pictor-windows-installer-'))
const installationDirectory = join(testRoot, 'Installed Pictor')
const profile = join(testRoot, 'user data preserved')
const commandCwd = join(testRoot, 'command cwd')
const marker = join(profile, 'keep-after-uninstall')
const userPathBefore = await readUserPath()
await mkdir(commandCwd, { recursive: true })
await mkdir(profile, { recursive: true })
await writeFile(marker, 'user data\n', 'utf8')

let installed = false
let application = null
try {
  await execute(installer, ['/S', `/D=${installationDirectory}`], {
    cwd: repositoryRoot,
    maxBuffer: 2 * 1024 * 1024,
  })
  installed = true
  const userPathAfterInstall = await readUserPath()
  if (userPathAfterInstall !== userPathBefore) {
    throw new Error('NSIS installation unexpectedly changed the user PATH')
  }
  const executable = join(installationDirectory, 'Pictor.exe')
  const launcher = join(installationDirectory, 'bin', 'pictor.cmd')
  await requireFile(executable)
  await requireFile(launcher)
  await requireFile(join(installationDirectory, 'resources', 'app.asar'))
  const desktopShortcut = await readDesktopShortcut()
  if (!desktopShortcut.toLowerCase().endsWith('\\bin\\pictor.cmd')) {
    throw new Error(`Windows desktop shortcut does not target bin\\pictor.cmd: ${desktopShortcut}`)
  }

  application = await launchPackagedGui(executable, [`--safe-mode`, `--user-data-dir=${profile}`], {
    env: withoutRunAsNode(process.env),
  })
  const window = await application.firstWindow()
  await window.waitForSelector('.pictor-shell', { timeout: 30_000 })
  await application.close()
  application = null

  const cliHelp = await runLauncher(launcher, ['cli', '--help'])
  assertCommand(cliHelp, 'installed Windows CLI help', 'Usage: pictor cli')
  const cliDoctor = await runLauncher(launcher, ['cli', '--user-data-dir', profile, 'doctor'])
  assertCommand(cliDoctor, 'installed Windows CLI doctor', 'plugin-store')
  const tuiHelp = await runLauncher(launcher, ['tui', '--help'])
  assertCommand(tuiHelp, 'installed Windows TUI help', 'Usage: pictor tui')
  const tuiNonInteractive = await runLauncher(launcher, [
    'tui',
    '--non-interactive',
    '--user-data-dir',
    profile,
  ])
  assertCommand(tuiNonInteractive, 'installed Windows TUI non-interactive', 'Pictor TUI 首次使用')

  const uninstaller = join(installationDirectory, 'Uninstall Pictor.exe')
  await requireFile(uninstaller)
  await execute(uninstaller, ['/S'], { cwd: installationDirectory, maxBuffer: 2 * 1024 * 1024 })
  await waitForPathRemoval(installationDirectory)
  if (await readDesktopShortcut()) {
    throw new Error('NSIS uninstall left the Pictor desktop shortcut')
  }
  if ((await readUserPath()) !== userPathBefore) {
    throw new Error('NSIS uninstall changed the user PATH')
  }
  await requireFile(marker)

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        installer,
        installationDirectory,
        gui: 'installed Pictor Shell',
        desktopShortcut,
        frontends: {
          cliHelp: summarize(cliHelp),
          cliDoctor: summarize(cliDoctor),
          tuiHelp: summarize(tuiHelp),
          tuiNonInteractive: summarize(tuiNonInteractive),
        },
        uninstall: { removedInstallation: true, preservedUserData: true, marker },
        pathMutation: 'none; bin/pictor.cmd has a stable explicit installation path',
      },
      null,
      2,
    )}\n`,
  )
} finally {
  if (application) await application.close().catch(() => undefined)
  if (installed && (await stat(installationDirectory).catch(() => null))) {
    const uninstaller = join(installationDirectory, 'Uninstall Pictor.exe')
    if (await stat(uninstaller).catch(() => null)) {
      await execute(uninstaller, ['/S'], { cwd: installationDirectory }).catch(() => undefined)
      await waitForPathRemoval(installationDirectory).catch(() => undefined)
    }
  }
  await rm(testRoot, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
}

async function readDesktopShortcut() {
  const script = [
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    "$link = Join-Path $desktop 'Pictor.lnk'",
    'if (-not (Test-Path -LiteralPath $link)) { exit 0 }',
    '$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)',
    'Write-Output $shortcut.TargetPath',
  ].join('; ')
  const { stdout } = await execute('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ])
  return stdout.trim()
}

async function readUserPath() {
  const { stdout } = await execute('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "[Environment]::GetEnvironmentVariable('Path', 'User')",
  ])
  return stdout.trim()
}

async function requireFile(path) {
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isFile() || metadata.size === 0) throw new Error(`Missing file: ${path}`)
}

async function waitForPathRemoval(path, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await stat(path).catch(() => null))) return
    await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, 100))
  }
  throw new Error(`NSIS uninstall left the installation directory: ${path}`)
}

function runLauncher(launcher, arguments_) {
  const command = process.env.ComSpec ?? 'cmd.exe'
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const commandLine = `call ${quoteForCmd(launcher)} ${arguments_.map(quoteForCmd).join(' ')}`
  return execute(command, ['/d', '/s', '/c', commandLine], {
    cwd: commandCwd,
    windowsVerbatimArguments: true,
    env: {
      ...withoutRunAsNode(process.env),
      PATH: `${systemRoot}\\System32`,
      ELECTRON_RUN_AS_NODE: '1',
    },
    maxBuffer: 4 * 1024 * 1024,
  })
    .then(({ stdout, stderr }) => ({ exitCode: 0, signal: null, stdout, stderr }))
    .catch((error) => ({
      exitCode: error.code ?? 1,
      signal: null,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error),
    }))
}

function withoutRunAsNode(environment) {
  const clean = { ...environment }
  delete clean.ELECTRON_RUN_AS_NODE
  return clean
}

function quoteForCmd(argument) {
  return `"${String(argument).replaceAll('"', '\\"')}"`
}

function assertCommand(result, label, expectedOutput) {
  if (result.exitCode !== 0 || !result.stdout.includes(expectedOutput)) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  }
}

function summarize(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout.slice(0, 1_000),
    stderr: result.stderr.slice(0, 1_000),
  }
}
