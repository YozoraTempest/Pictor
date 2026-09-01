import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { launchPackagedGui } from './packaged-gui.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const testRoot = await mkdtemp(resolve(tmpdir(), 'pictor-profile-lock-'))
const profile = join(testRoot, 'shared-profile')
const commandCwd = join(testRoot, 'cwd')
await mkdir(profile, { recursive: true })
await mkdir(commandCwd, { recursive: true })
const isWindows = process.platform === 'win32'
const guiExecutable = resolve(
  process.env.PICTOR_GUI_EXECUTABLE ??
    (isWindows
      ? resolve(repositoryRoot, 'dist', 'win-unpacked', 'Pictor.exe')
      : resolve(repositoryRoot, 'dist', 'linux-unpacked', 'pictor')),
)
const launcher = resolve(
  process.env.PICTOR_FRONTEND_LAUNCHER ??
    (isWindows
      ? resolve(repositoryRoot, 'dist', 'win-unpacked', 'bin', 'pictor.cmd')
      : guiExecutable),
)

let electronApp
try {
  electronApp = await launchPackagedGui(
    guiExecutable,
    [`--user-data-dir=${profile}`],
    isWindows ? {} : { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  )
  const window = await electronApp.firstWindow()
  await window.waitForSelector('.app-shell', { timeout: 30_000 })

  const cliConflict = await runFrontend(['cli', '--user-data-dir', profile, 'doctor'])
  assertConflict(cliConflict, 'CLI')

  const tuiConflict = await runFrontend(['tui', '--non-interactive', '--user-data-dir', profile])
  assertConflict(tuiConflict, 'TUI')

  await electronApp.close()
  electronApp = null

  const cliAfterRelease = await runFrontend(['cli', '--user-data-dir', profile, 'doctor'])
  assertSuccess(cliAfterRelease, 'CLI after GUI release', 'Doctor:')
  const tuiAfterRelease = await runFrontend([
    'tui',
    '--non-interactive',
    '--user-data-dir',
    profile,
  ])
  assertSuccess(tuiAfterRelease, 'TUI after CLI release', 'Pictor TUI 首次使用')

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        profile,
        owner: 'gui',
        conflicts: {
          cli: summarize(cliConflict),
          tui: summarize(tuiConflict),
        },
        releases: {
          cli: summarize(cliAfterRelease),
          tui: summarize(tuiAfterRelease),
        },
      },
      null,
      2,
    )}\n`,
  )
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
}

function runFrontend(arguments_) {
  const environment = { ...process.env }
  const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : launcher
  const commandArguments = isWindows
    ? ['/d', '/s', '/c', `${quoteForCmd(launcher)} ${arguments_.map(quoteForCmd).join(' ')}`]
    : arguments_
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArguments, {
      cwd: commandCwd,
      windowsVerbatimArguments: isWindows,
      env: {
        ...environment,
        ...(launcher.toLowerCase().endsWith('.appimage') ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
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
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => resolvePromise({ exitCode, signal, stdout, stderr }))
  })
}

function quoteForCmd(argument) {
  return `"${String(argument).replaceAll('"', '\\"')}"`
}

function assertConflict(result, label) {
  if (result.exitCode !== 4 || !`${result.stdout}\n${result.stderr}`.includes('Profile 已被占用')) {
    throw new Error(
      `${label} did not reach the stable Profile conflict terminal state: ${JSON.stringify(result)}`,
    )
  }
}

function assertSuccess(result, label, expectedOutput) {
  if (result.exitCode !== 0 || !result.stdout.includes(expectedOutput)) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  }
}

function summarize(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout.slice(0, 500),
    stderr: result.stderr.slice(0, 500),
  }
}
