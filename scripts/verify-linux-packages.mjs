import { execFile } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { stdout } from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  requireNonEmptyFile,
  verifyApplicationArchive,
  verifyBundledPlugins,
} from './verify-package-contents.mjs'
import { assertFuseWire } from './electron-fuses.mjs'
import {
  assertCommand,
  launchPackagedGui,
  runPackagedFrontend,
  summarizeCommand,
} from './package-harness.mjs'

const execute = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const outputDirectory = resolve(repositoryRoot, 'dist')
const artifacts = {
  arch: resolve(outputDirectory, `Pictor-${packageMetadata.version}-arch-x64.pacman`),
  appImage: resolve(outputDirectory, `Pictor-${packageMetadata.version}-linux-x64.AppImage`),
}
const expectedArchDependencies = [
  'alsa-lib',
  'at-spi2-core',
  'cairo',
  'dbus',
  'expat',
  'glib2',
  'glibc',
  'gtk3',
  'libcups',
  'libgcc',
  'libsecret',
  'libx11',
  'libxcb',
  'libxcomposite',
  'libxdamage',
  'libxext',
  'libxfixes',
  'libxkbcommon',
  'libxrandr',
  'mesa',
  'nspr',
  'nss',
  'pango',
  'systemd-libs',
  'xdg-utils',
]

async function extract(path, destination) {
  await execute('bsdtar', ['-xf', path, '-C', destination])
}

function parseMetadataEntries(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.split(/:\s*|\s*=\s*/, 2))
    .filter((entry) => entry.length === 2)
}

function parseMetadata(content) {
  return new Map(parseMetadataEntries(content))
}

async function verifyElfX64(path, label) {
  const header = (await readFile(path)).subarray(0, 20)
  if (header.length < 20 || header.toString('ascii', 0, 4) !== '\u007fELF') {
    throw new Error(`Expected an ELF executable for ${label}: ${path}`)
  }
  if (header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== 0x3e) {
    throw new Error(`Expected a little-endian x86-64 ELF executable for ${label}: ${path}`)
  }
}

async function verifyLauncher(path, label) {
  const metadata = await stat(path)
  if ((metadata.mode & 0o111) === 0) throw new Error(`${label} is not executable: ${path}`)
  const content = await readFile(path, 'utf8')
  for (const fragment of [
    '#!/bin/sh',
    'APPDIR',
    'PICTOR_PACKAGE_ROOT',
    'PICTOR_BUNDLED_PLUGINS_DIRECTORY',
    'ELECTRON_RUN_AS_NODE=1',
    'unset ELECTRON_RUN_AS_NODE',
    'out/cli/src/cli/entry.js',
    'out/tui/src/tui/entry.js',
    'pictor-gui',
  ]) {
    if (!content.includes(fragment))
      throw new Error(`${label} misses launcher fragment ${fragment}`)
  }
}

async function verifyInstalledPayload(root, label) {
  const appRoot = resolve(root, 'opt', 'Pictor')
  const launcher = resolve(appRoot, 'pictor')
  const guiBinary = resolve(appRoot, 'pictor-gui')
  const applicationArchive = resolve(appRoot, 'resources', 'app.asar')
  const bundledPlugins = resolve(appRoot, 'resources', 'bundled-plugins')
  const desktopEntry = resolve(root, 'usr', 'share', 'applications', 'pictor.desktop')
  const sizes = {
    launcher: await requireNonEmptyFile(launcher, `${label} launcher`),
    guiBinary: await requireNonEmptyFile(guiBinary, `${label} GUI binary`),
    applicationArchive: await requireNonEmptyFile(applicationArchive, `${label} app.asar`),
    desktopEntry: await requireNonEmptyFile(desktopEntry, `${label} desktop entry`),
  }
  await verifyLauncher(launcher, `${label} launcher`)
  await verifyElfX64(guiBinary, `${label} GUI binary`)
  const fuses = await assertFuseWire(guiBinary, `${label} GUI binary`)
  const appAsar = await verifyApplicationArchive(
    applicationArchive,
    packageMetadata.version,
    `${label} app.asar`,
  )
  const plugins = await verifyBundledPlugins(
    bundledPlugins,
    packageMetadata.version,
    `${label} bundled plugins`,
  )
  const desktopContent = await readFile(desktopEntry, 'utf8')
  if (!desktopContent.includes('Exec=/opt/Pictor/pictor %U')) {
    throw new Error(`Expected the ${label} desktop entry to launch /opt/Pictor/pictor`)
  }
  if (
    !desktopContent.includes('StartupWMClass=pictor') ||
    !desktopContent.includes('Terminal=false')
  ) {
    throw new Error(`Expected the ${label} desktop entry to identify the GUI launcher`)
  }
  return { sizes, fuses, appAsar, plugins }
}

async function verifyAppImage(temporaryRoot) {
  await requireNonEmptyFile(artifacts.appImage, 'AppImage artifact')
  await verifyElfX64(artifacts.appImage, 'AppImage runtime')
  await chmod(artifacts.appImage, 0o755)
  const extractionDirectory = resolve(temporaryRoot, 'appimage')
  await mkdir(extractionDirectory, { recursive: true })
  await execute(artifacts.appImage, ['--appimage-extract'], {
    cwd: extractionDirectory,
    maxBuffer: 10 * 1024 * 1024,
  })
  const payload = resolve(extractionDirectory, 'squashfs-root')
  const desktopEntryName = (await readdir(payload)).find((entry) => entry.endsWith('.desktop'))
  if (!desktopEntryName) throw new Error('Expected a desktop entry inside the AppImage')

  const launcher = resolve(payload, 'pictor')
  const guiBinary = resolve(payload, 'pictor-gui')
  const applicationArchive = resolve(payload, 'resources', 'app.asar')
  const bundledPlugins = resolve(payload, 'resources', 'bundled-plugins')
  const appRun = resolve(payload, 'AppRun')
  const sizes = {
    appRun: await requireNonEmptyFile(appRun, 'AppImage AppRun'),
    launcher: await requireNonEmptyFile(launcher, 'AppImage POSIX launcher'),
    guiBinary: await requireNonEmptyFile(guiBinary, 'AppImage GUI binary'),
    applicationArchive: await requireNonEmptyFile(applicationArchive, 'AppImage app.asar'),
    desktopEntry: await requireNonEmptyFile(
      resolve(payload, desktopEntryName),
      'AppImage desktop entry',
    ),
  }
  const appRunContent = await readFile(appRun, 'utf8')
  if (!appRunContent.includes('APPDIR') || !appRunContent.includes('BIN="$APPDIR/pictor"')) {
    throw new Error('AppImage AppRun does not enter the shared POSIX launcher')
  }
  await verifyLauncher(launcher, 'AppImage POSIX launcher')
  await verifyElfX64(guiBinary, 'AppImage GUI binary')
  const fuses = await assertFuseWire(guiBinary, 'AppImage GUI binary')
  const appAsar = await verifyApplicationArchive(
    applicationArchive,
    packageMetadata.version,
    'AppImage app.asar',
  )
  const plugins = await verifyBundledPlugins(
    bundledPlugins,
    packageMetadata.version,
    'AppImage bundled plugins',
  )
  const desktopContent = await readFile(resolve(payload, desktopEntryName), 'utf8')
  if (
    !desktopContent.includes('Exec=AppRun %U') ||
    !desktopContent.includes('StartupWMClass=pictor')
  ) {
    throw new Error('Expected the AppImage desktop entry to enter AppRun/pictor')
  }
  return { sizes, fuses, appAsar, plugins }
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'pictor-linux-package-'))
try {
  const archData = resolve(temporaryRoot, 'arch-data')
  await mkdir(archData, { recursive: true })
  await extract(artifacts.arch, archData)
  const packageInfoContent = await readFile(resolve(archData, '.PKGINFO'), 'utf8')
  const packageInfo = parseMetadata(packageInfoContent)
  if (packageInfo.get('arch') !== 'x86_64') {
    throw new Error(`Expected Pacman architecture x86_64, received ${packageInfo.get('arch')}`)
  }
  if (
    packageInfo.get('pkgname') !== packageMetadata.name ||
    packageInfo.get('pkgver') !== `${packageMetadata.version}-1`
  ) {
    throw new Error('Pacman package name, application version, or package release is invalid')
  }
  const archDependencies = parseMetadataEntries(packageInfoContent)
    .filter(([key]) => key === 'depend')
    .map(([, value]) => value)
    .toSorted()
  if (JSON.stringify(archDependencies) !== JSON.stringify(expectedArchDependencies)) {
    throw new Error(
      `Pacman dependencies do not match the Arch baseline: ${archDependencies.join(', ')}`,
    )
  }

  const packageSizes = {
    arch: await requireNonEmptyFile(artifacts.arch, 'Pacman artifact'),
    appImage: await requireNonEmptyFile(artifacts.appImage, 'AppImage artifact'),
  }
  const payloads = {
    arch: await verifyInstalledPayload(archData, 'Pacman payload'),
    appImage: await verifyAppImage(temporaryRoot),
  }
  const runtime = await verifyRuntime(temporaryRoot)
  stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        architecture: 'x64',
        packages: Object.fromEntries(
          Object.entries(artifacts).map(([name, path]) => [
            name,
            {
              path: relative(repositoryRoot, path).replaceAll('\\', '/'),
              bytes: packageSizes[name],
            },
          ]),
        ),
        payloads,
        runtime,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function verifyRuntime(temporaryRoot) {
  const executable = join(temporaryRoot, 'AppImage path with spaces', 'Pictor.AppImage')
  const commandPath = join(temporaryRoot, 'node-free-bin')
  const commandCwd = join(temporaryRoot, 'cwd with spaces')
  const profile = join(temporaryRoot, 'shared profile')
  const tuiProfile = join(temporaryRoot, 'tui profile')
  await mkdir(dirname(executable), { recursive: true })
  await copyFile(artifacts.appImage, executable)
  await chmod(executable, 0o755)
  await mkdir(commandPath, { recursive: true })
  await mkdir(commandCwd, { recursive: true })
  await mkdir(profile, { recursive: true })
  await writeFile(join(commandCwd, 'package.json'), '{"version":"99.99.99"}\n', 'utf8')

  for (const command of ['bash', 'dirname', 'env', 'readlink', 'true', 'unshare']) {
    const candidate = resolve('/usr/bin', command)
    try {
      await symlink(candidate, join(commandPath, command))
    } catch {
      // AppRun treats a missing unshare probe as the no-sandbox case.
    }
  }

  const environment = {
    PATH: commandPath,
    ELECTRON_RUN_AS_NODE: '1',
  }
  let gui = null
  try {
    gui = await launchPackagedGui(executable, [`--user-data-dir=${profile}`], {
      cwd: commandCwd,
      env: environment,
    })
    const pageTarget = gui.pageTarget.url
    const conflict = await runPackagedFrontend(
      executable,
      ['cli', '--user-data-dir', profile, 'doctor'],
      { cwd: commandCwd, env: environment },
    )
    assertCommand(conflict, 'AppImage CLI profile conflict', 'Profile 已被占用', 4)
    await gui.close()
    gui = null

    const cli = await runPackagedFrontend(
      executable,
      ['cli', '--user-data-dir', profile, 'doctor'],
      { cwd: commandCwd, env: environment },
    )
    assertCommand(cli, 'AppImage CLI doctor', 'Doctor:')
    const tui = await runPackagedFrontend(
      executable,
      ['tui', '--non-interactive', '--user-data-dir', tuiProfile],
      { cwd: commandCwd, env: environment },
    )
    assertCommand(tui, 'AppImage TUI non-interactive', 'Pictor TUI 首次使用')

    return {
      pageTarget,
      nodeFreePath: commandPath,
      profileConflict: summarizeCommand(conflict),
      cli: summarizeCommand(cli),
      tui: summarizeCommand(tui),
    }
  } finally {
    if (gui) await gui.close().catch(() => undefined)
  }
}
