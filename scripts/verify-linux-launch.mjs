import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

import { collectLaunchEvidence } from './linux-launch-readiness.mjs'
import { launchPackagedGui } from './packaged-gui.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const requestedExecutablePath = resolve(
  process.env.PICTOR_LINUX_EXECUTABLE ??
    resolve(repositoryRoot, 'dist', 'linux-unpacked', 'pictor'),
)
const expectedDistribution = process.env.PICTOR_EXPECTED_DISTRIBUTION
if (expectedDistribution && !['arch', 'unsupported-linux'].includes(expectedDistribution)) {
  throw new Error(`Unsupported expected distribution: ${expectedDistribution}`)
}

const testRoot = await mkdtemp(resolve(tmpdir(), 'pictor-linux-launch-'))
const executablePath = await prepareExecutable(requestedExecutablePath, testRoot)
const commandPath = await createNodeFreePath(testRoot)
const commandCwd = join(testRoot, 'cwd with spaces')
await mkdir(commandCwd, { recursive: true })
await writeFile(join(commandCwd, 'package.json'), '{"version":"99.99.99"}\n', 'utf8')
await mkdir(join(commandCwd, '.pictor', 'bundled-plugins'), { recursive: true })
const explicitUserData = process.env.PICTOR_USER_DATA_DIR
const userDataDirectory = explicitUserData
  ? resolve(explicitUserData)
  : join(testRoot, 'gui-user-data')
await mkdir(userDataDirectory, { recursive: true })

const electronApp = await launchPackagedGui(
  executablePath,
  [`--user-data-dir=${userDataDirectory}`],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
)
let window

const captureScreenshot = async () => {
  if (!window || !process.env.PICTOR_SCREENSHOT_PATH) return
  const screenshotPath = resolve(process.env.PICTOR_SCREENSHOT_PATH)
  await mkdir(dirname(screenshotPath), { recursive: true })
  await window.screenshot({ path: screenshotPath })
}

try {
  window = await electronApp.firstWindow()
  const evidence = await collectLaunchEvidence(window)

  const appInfo = evidence.appInfo
  if (appInfo.platform !== 'linux' || appInfo.arch !== 'x64') {
    throw new Error(`Expected Linux x64, received ${appInfo.platform} ${appInfo.arch}`)
  }
  if (appInfo.version !== packageMetadata.version) {
    throw new Error(`Expected version ${packageMetadata.version}, received ${appInfo.version}`)
  }
  if (expectedDistribution && appInfo.distribution !== expectedDistribution) {
    throw new Error(
      `Expected ${expectedDistribution} distribution, received ${appInfo.distribution}`,
    )
  }
  if (
    evidence.title !== 'Pictor' ||
    evidence.bodyTextLength === 0 ||
    !evidence.shell ||
    evidence.shell.width <= 0 ||
    evidence.shell.height <= 0
  ) {
    throw new Error(`Packaged renderer did not mount: ${JSON.stringify(evidence)}`)
  }
  await captureScreenshot()

  const cliHelp = await runLauncher(executablePath, ['cli', '--help'], commandCwd, commandPath)
  assertCommand(cliHelp, 'CLI help', 'Usage: pictor cli')
  const cliProfile = join(testRoot, 'cli-profile')
  const cliDoctor = await runLauncher(
    executablePath,
    ['cli', '--user-data-dir', cliProfile, 'doctor'],
    commandCwd,
    commandPath,
  )
  assertCommand(cliDoctor, 'CLI doctor', 'plugin-store')
  const tuiHelp = await runLauncher(executablePath, ['tui', '--help'], commandCwd, commandPath)
  assertCommand(tuiHelp, 'TUI help', 'Usage: pictor tui')
  const tuiProfile = join(testRoot, 'tui-profile')
  const tuiNonInteractive = await runLauncher(
    executablePath,
    ['tui', '--non-interactive', '--user-data-dir', tuiProfile],
    commandCwd,
    commandPath,
  )
  assertCommand(tuiNonInteractive, 'TUI non-interactive', 'Pictor TUI 首次使用')

  stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        executablePath,
        cwd: commandCwd,
        nodeFreePath: commandPath,
        appInfo,
        gui: {
          title: evidence.title,
          bodyTextLength: evidence.bodyTextLength,
          shell: evidence.shell,
        },
        frontends: {
          cliHelp: summarizeCommand(cliHelp),
          cliDoctor: summarizeCommand(cliDoctor),
          tuiHelp: summarizeCommand(tuiHelp),
          tuiNonInteractive: summarizeCommand(tuiNonInteractive),
        },
      },
      null,
      2,
    )}\n`,
  )
} catch (error) {
  try {
    await captureScreenshot()
  } catch (screenshotError) {
    process.stderr.write(`Failed to capture packaged renderer evidence: ${screenshotError}\n`)
  }
  throw error
} finally {
  await electronApp.close()
  if (!explicitUserData) await rm(userDataDirectory, { recursive: true, force: true })
  await rm(testRoot, { recursive: true, force: true })
}

async function prepareExecutable(path, root) {
  if (!path.endsWith('.AppImage')) return path
  const copy = join(root, 'AppImage path with spaces', 'Pictor.AppImage')
  await mkdir(dirname(copy), { recursive: true })
  await copyFile(path, copy)
  await chmod(copy, 0o755)
  return copy
}

async function createNodeFreePath(root) {
  const path = join(root, 'node-free-bin')
  await mkdir(path, { recursive: true })
  const commands = ['bash', 'dirname', 'env', 'readlink', 'true', 'unshare']
  for (const command of commands) {
    const candidate = resolve('/usr/bin', command)
    try {
      await symlink(candidate, join(path, command))
    } catch {
      // AppRun deliberately treats a missing unshare probe as the no-sandbox case.
    }
  }
  return path
}

function runLauncher(executable, arguments_, cwd, commandPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: {
        ...process.env,
        PATH: commandPath,
        ELECTRON_RUN_AS_NODE: '1',
        ...(executable.toLowerCase().endsWith('.appimage')
          ? { APPIMAGE_EXTRACT_AND_RUN: '1' }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let childStdout = ''
    let childStderr = ''
    let timedOut = false
    const timer = globalThis.setTimeout(() => {
      timedOut = true
      child.kill()
    }, 30_000)
    child.stdout.on('data', (chunk) => {
      childStdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      childStderr += chunk.toString()
    })
    child.once('error', (error) => {
      globalThis.clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (exitCode, signal) => {
      globalThis.clearTimeout(timer)
      resolvePromise({ exitCode, signal, timedOut, stdout: childStdout, stderr: childStderr })
    })
  })
}

function assertCommand(result, label, expectedOutput) {
  if (result.timedOut || result.exitCode !== 0 || !result.stdout.includes(expectedOutput)) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  }
}

function summarizeCommand(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout.slice(0, 1_000),
    stderr: result.stderr.slice(0, 1_000),
  }
}
