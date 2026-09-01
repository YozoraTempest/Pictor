import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { launchPackagedGui } from './packaged-gui.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const testRoot = await mkdtemp(join(process.env.TEMP ?? tmpdir(), 'pictor-windows-launch-'))
const profile = join(testRoot, 'profile with spaces')
const commandCwd = join(testRoot, 'cwd with spaces')
await mkdir(profile, { recursive: true })
await mkdir(commandCwd, { recursive: true })
await writeFile(join(commandCwd, 'package.json'), '{"version":"99.99.99"}\n', 'utf8')
await mkdir(join(commandCwd, '.pictor', 'bundled-plugins'), { recursive: true })

const executablePath = resolve(
  process.env.PICTOR_WINDOWS_EXECUTABLE ??
    resolve(repositoryRoot, 'dist', 'win-unpacked', 'Pictor.exe'),
)
const launcher = resolve(
  process.env.PICTOR_WINDOWS_LAUNCHER ??
    resolve(repositoryRoot, 'dist', 'win-unpacked', 'bin', 'pictor.cmd'),
)

let electronApp = null
try {
  electronApp = await launchPackagedGui(launcher, [`--user-data-dir=${profile}`], {
    cwd: commandCwd,
    shell: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  const window = await electronApp.firstWindow()
  await window.waitForSelector('.app-shell', { timeout: 30_000 })
  if ((await window.title()) !== 'Pictor')
    throw new Error('Windows packaged GUI title is not Pictor')
  await electronApp.close()
  electronApp = null

  const cliHelp = await runLauncher(['cli', '--help'])
  assertCommand(cliHelp, 'Windows CLI help', 'Usage: pictor cli')
  const cliProfile = join(testRoot, 'cli-profile')
  const cliDoctor = await runLauncher(['cli', '--user-data-dir', cliProfile, 'doctor'])
  assertCommand(cliDoctor, 'Windows CLI doctor', 'plugin-store')
  const tuiHelp = await runLauncher(['tui', '--help'])
  assertCommand(tuiHelp, 'Windows TUI help', 'Usage: pictor tui')
  const tuiProfile = join(testRoot, 'tui-profile')
  const tuiNonInteractive = await runLauncher([
    'tui',
    '--non-interactive',
    '--user-data-dir',
    tuiProfile,
  ])
  assertCommand(tuiNonInteractive, 'Windows TUI non-interactive', 'Pictor TUI 首次使用')

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        executablePath,
        launcher,
        cwd: commandCwd,
        gui: { title: 'Pictor', terminalState: 'app-shell' },
        frontends: {
          cliHelp: summarize(cliHelp),
          cliDoctor: summarize(cliDoctor),
          tuiHelp: summarize(tuiHelp),
          tuiNonInteractive: summarize(tuiNonInteractive),
        },
        systemNode: 'not required; command PATH is restricted to Windows system tools',
      },
      null,
      2,
    )}\n`,
  )
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
}

function runLauncher(arguments_) {
  const command = process.env.ComSpec ?? 'cmd.exe'
  const commandLine = `${quoteForCmd(launcher)} ${arguments_.map(quoteForCmd).join(' ')}`
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['/d', '/s', '/c', commandLine], {
      cwd: commandCwd,
      env: {
        ...process.env,
        PATH: `${systemRoot}\\System32`,
        ELECTRON_RUN_AS_NODE: '1',
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
