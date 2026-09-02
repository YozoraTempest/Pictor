import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import process, { stdout } from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { assertFuseWire } from './electron-fuses.mjs'
import {
  assertCommand,
  launchPackagedGui,
  runPackagedFrontend,
  summarizeCommand,
} from './package-harness.mjs'
import {
  requireNonEmptyFile,
  verifyApplicationArchive,
  verifyBundledPlugins,
} from './verify-package-contents.mjs'

const execute = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const outputDirectory = resolve(repositoryRoot, 'dist')
const artifacts = {
  installer: resolve(outputDirectory, `Pictor-${packageMetadata.version}-windows-x64-setup.exe`),
  executable: resolve(outputDirectory, 'win-unpacked', 'Pictor.exe'),
  launcher: resolve(outputDirectory, 'win-unpacked', 'bin', 'pictor.cmd'),
  applicationArchive: resolve(outputDirectory, 'win-unpacked', 'resources', 'app.asar'),
  bundledPlugins: resolve(outputDirectory, 'win-unpacked', 'resources', 'bundled-plugins'),
}

const structure = await verifyStructure()
const runtime = await verifyRuntime(artifacts.executable, artifacts.launcher)
const installer = await verifyInstaller()

stdout.write(
  `${JSON.stringify(
    {
      verified: true,
      version: packageMetadata.version,
      architecture: 'x64',
      structure,
      runtime,
      installer,
    },
    null,
    2,
  )}\n`,
)

async function verifyStructure() {
  const sizes = Object.fromEntries(
    await Promise.all(
      Object.entries(artifacts)
        .filter(([name]) => name !== 'bundledPlugins')
        .map(async ([name, path]) => [name, await requireNonEmptyFile(path, name)]),
    ),
  )
  const executableMachine = await readPeMachine(artifacts.executable)
  if (executableMachine !== 0x8664) {
    throw new Error(
      `Expected an x64 unpacked executable (PE machine 0x8664), received 0x${executableMachine.toString(16)}`,
    )
  }

  const launcher = await readFile(artifacts.launcher, 'utf8')
  for (const fragment of [
    '@echo off',
    'ELECTRON_RUN_AS_NODE=1',
    'ELECTRON_RUN_AS_NODE=',
    'PICTOR_PACKAGE_ROOT',
    'PICTOR_BUNDLED_PLUGINS_DIRECTORY',
    'out\\cli\\src\\cli\\entry.js',
    'out\\tui\\src\\tui\\entry.js',
    'Pictor.exe',
  ]) {
    if (!launcher.includes(fragment)) {
      throw new Error(`Windows pictor.cmd misses launcher fragment ${fragment}`)
    }
  }

  const installerInclude = await readFile(
    resolve(repositoryRoot, 'packaging', 'windows', 'installer.nsh'),
    'utf8',
  )
  for (const fragment of [
    '!macro customInstall',
    'bin\\pictor.cmd',
    '!macro customUnInstall',
    'WinShell::UninstShortcut "$newDesktopLink"',
    'WinShell::UninstShortcut "$newStartMenuLink"',
  ]) {
    if (!installerInclude.includes(fragment)) {
      throw new Error(`Windows installer misses shortcut contract ${fragment}`)
    }
  }

  return {
    guiBinary: 'PE x64 Pictor.exe',
    launcher: 'bin/pictor.cmd',
    appAsar: await verifyApplicationArchive(
      artifacts.applicationArchive,
      packageMetadata.version,
      'Windows app.asar',
    ),
    fuses: await assertFuseWire(artifacts.executable, 'Windows Pictor.exe'),
    bundledPlugins: await verifyBundledPlugins(
      artifacts.bundledPlugins,
      packageMetadata.version,
      'Windows bundled plugins',
    ),
    artifacts: Object.fromEntries(
      Object.entries(sizes).map(([name, bytes]) => [
        name,
        { path: relative(repositoryRoot, artifacts[name]).replaceAll('\\', '/'), bytes },
      ]),
    ),
  }
}

async function verifyRuntime(executable, launcher) {
  const testRoot = await mkdtemp(join(process.env.TEMP ?? tmpdir(), 'pictor-windows-package-'))
  const profile = join(testRoot, 'shared profile')
  const tuiProfile = join(testRoot, 'tui profile')
  const commandCwd = join(testRoot, 'cwd with spaces')
  await mkdir(profile, { recursive: true })
  await mkdir(commandCwd, { recursive: true })
  await writeFile(join(commandCwd, 'package.json'), '{"version":"99.99.99"}\n', 'utf8')

  let gui = null
  try {
    gui = await launchPackagedGui(executable, [`--user-data-dir=${profile}`], {
      launcherPath: launcher,
      cwd: commandCwd,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    const pageTarget = gui.pageTarget.url
    const conflict = await runFrontend(launcher, ['cli', '--user-data-dir', profile, 'doctor'], {
      cwd: commandCwd,
    })
    assertCommand(conflict, 'Windows CLI profile conflict', 'Profile 已被占用', 4)
    await gui.close()
    gui = null

    const cli = await runFrontend(launcher, ['cli', '--user-data-dir', profile, 'doctor'], {
      cwd: commandCwd,
    })
    assertCommand(cli, 'Windows CLI doctor', 'Doctor:')
    const tui = await runFrontend(
      launcher,
      ['tui', '--non-interactive', '--user-data-dir', tuiProfile],
      { cwd: commandCwd },
    )
    assertCommand(tui, 'Windows TUI non-interactive', 'Pictor TUI 首次使用')

    return {
      pageTarget,
      profileConflict: summarizeCommand(conflict),
      cli: summarizeCommand(cli),
      tui: summarizeCommand(tui),
    }
  } finally {
    if (gui) await gui.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
  }
}

async function verifyInstaller() {
  const testRoot = await mkdtemp(join(process.env.TEMP ?? tmpdir(), 'pictor-windows-installer-'))
  const installationDirectory = join(testRoot, 'Installed Pictor')
  const profile = join(testRoot, 'user data preserved')
  const marker = join(profile, 'keep-after-uninstall')
  const userPathBefore = await readUserPath()
  await mkdir(profile, { recursive: true })
  await writeFile(marker, 'user data\n', 'utf8')

  let installed = false
  let gui = null
  try {
    await execute(artifacts.installer, ['/S', `/D=${installationDirectory}`], {
      cwd: repositoryRoot,
      maxBuffer: 2 * 1024 * 1024,
    })
    installed = true
    if ((await readUserPath()) !== userPathBefore) {
      throw new Error('NSIS installation unexpectedly changed the user PATH')
    }

    const executable = join(installationDirectory, 'Pictor.exe')
    const launcher = join(installationDirectory, 'bin', 'pictor.cmd')
    await requireNonEmptyFile(executable, 'installed Pictor.exe')
    await requireNonEmptyFile(launcher, 'installed pictor.cmd')
    const desktopShortcut = await readDesktopShortcut()
    if (!desktopShortcut.toLowerCase().endsWith('\\bin\\pictor.cmd')) {
      throw new Error(
        `Windows desktop shortcut does not target bin\\pictor.cmd: ${desktopShortcut}`,
      )
    }

    gui = await launchPackagedGui(executable, [`--safe-mode`, `--user-data-dir=${profile}`], {
      launcherPath: launcher,
      cwd: installationDirectory,
    })
    const pageTarget = gui.pageTarget.url
    await gui.close()
    gui = null
    const cli = await runFrontend(launcher, ['cli', '--help'], { cwd: installationDirectory })
    assertCommand(cli, 'installed Windows CLI help', 'Usage: pictor cli')

    const uninstaller = join(installationDirectory, 'Uninstall Pictor.exe')
    await requireNonEmptyFile(uninstaller, 'Windows uninstaller')
    await execute(uninstaller, ['/S'], {
      cwd: installationDirectory,
      maxBuffer: 2 * 1024 * 1024,
    })
    await waitForPathRemoval(installationDirectory)
    installed = false
    if (await readDesktopShortcut()) {
      throw new Error('NSIS uninstall left the Pictor desktop shortcut')
    }
    if ((await readUserPath()) !== userPathBefore) {
      throw new Error('NSIS uninstall changed the user PATH')
    }
    await requireNonEmptyFile(marker, 'preserved user data marker')

    return {
      installedGuiTarget: pageTarget,
      cli: summarizeCommand(cli),
      removedInstallation: true,
      preservedUserData: true,
      pathMutation: 'none',
    }
  } finally {
    if (gui) await gui.close().catch(() => undefined)
    if (installed && (await stat(installationDirectory).catch(() => null))) {
      const uninstaller = join(installationDirectory, 'Uninstall Pictor.exe')
      if (await stat(uninstaller).catch(() => null)) {
        await execute(uninstaller, ['/S'], { cwd: installationDirectory }).catch(() => undefined)
        await waitForPathRemoval(installationDirectory).catch(() => undefined)
      }
    }
    await rm(testRoot, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
  }
}

async function runFrontend(launcher, arguments_, options) {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return runPackagedFrontend(launcher, arguments_, {
    ...options,
    env: {
      PATH: `${systemRoot}\\System32`,
      ELECTRON_RUN_AS_NODE: '1',
    },
  })
}

async function readPeMachine(path) {
  const handle = await open(path, 'r')
  try {
    const dosHeader = Buffer.alloc(64)
    await handle.read(dosHeader, 0, dosHeader.length, 0)
    if (dosHeader.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(`Expected a PE executable: ${relative(repositoryRoot, path)}`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(6)
    await handle.read(peHeader, 0, peHeader.length, peOffset)
    if (peHeader.toString('ascii', 0, 4) !== 'PE\0\0') {
      throw new Error(`Expected a valid PE header: ${relative(repositoryRoot, path)}`)
    }
    return peHeader.readUInt16LE(4)
  } finally {
    await handle.close()
  }
}

async function readDesktopShortcut() {
  const script = [
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    "$link = Join-Path $desktop 'Pictor.lnk'",
    'if (-not (Test-Path -LiteralPath $link)) { exit 0 }',
    '$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)',
    'Write-Output $shortcut.TargetPath',
  ].join('; ')
  const { stdout: result } = await execute('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ])
  return result.trim()
}

async function readUserPath() {
  const { stdout: result } = await execute('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "[Environment]::GetEnvironmentVariable('Path', 'User')",
  ])
  return result.trim()
}

async function waitForPathRemoval(path, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await stat(path).catch(() => null))) return
    await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, 100))
  }
  throw new Error(`NSIS uninstall left the installation directory: ${path}`)
}
