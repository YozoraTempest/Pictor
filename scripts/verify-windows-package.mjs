import { Buffer } from 'node:buffer'
import { access, open, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

import { extractFile, listPackage } from '@electron/asar'

import { APP_ASAR_FRONTEND_ENTRIES, BUNDLED_PLUGIN_IDS } from './distribution-contract.mjs'
import { assertFuseWire } from './electron-fuses.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const outputDirectory = resolve(repositoryRoot, 'dist')
const installerName = `Pictor-${packageMetadata.version}-windows-x64-setup.exe`
const artifacts = {
  installer: resolve(outputDirectory, installerName),
  executable: resolve(outputDirectory, 'win-unpacked', 'Pictor.exe'),
  launcher: resolve(outputDirectory, 'win-unpacked', 'bin', 'pictor.cmd'),
  applicationArchive: resolve(outputDirectory, 'win-unpacked', 'resources', 'app.asar'),
  bundledPlugins: resolve(outputDirectory, 'win-unpacked', 'resources', 'bundled-plugins'),
}

async function requireNonEmptyFile(path) {
  await access(path)
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Expected a non-empty file: ${relative(repositoryRoot, path)}`)
  }
  return metadata.size
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

async function verifyBundledPlugins(root) {
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
  if (JSON.stringify(directories) !== JSON.stringify([...BUNDLED_PLUGIN_IDS].toSorted())) {
    throw new Error(`Expected 10 Windows Bundled Plugins, received ${directories.join(', ')}`)
  }

  const pluginSizes = {}
  for (const id of BUNDLED_PLUGIN_IDS) {
    const packageRoot = join(root, id)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
    if (manifest.id !== id || manifest.version !== packageMetadata.version) {
      throw new Error(`Bundled Plugin identity mismatch: ${relative(repositoryRoot, packageRoot)}`)
    }
    pluginSizes[id] = await requireNonEmptyFile(join(packageRoot, 'manifest.json'))
    await requireNonEmptyFile(join(packageRoot, 'package.json'))
    for (const [processName, entry] of Object.entries(manifest.modules ?? {})) {
      if (!['host', 'gui', 'tui', 'runtime'].includes(processName) || typeof entry !== 'string') {
        throw new Error(`Invalid Bundled Plugin entry ${id}:${processName}`)
      }
      await requireNonEmptyFile(join(packageRoot, entry))
    }
  }
  return pluginSizes
}

const sizes = Object.fromEntries(
  await Promise.all(
    Object.entries(artifacts)
      .filter(([name]) => name !== 'bundledPlugins')
      .map(async ([name, path]) => [name, await requireNonEmptyFile(path)]),
  ),
)
const executableMachine = await readPeMachine(artifacts.executable)
if (executableMachine !== 0x8664) {
  throw new Error(
    `Expected an x64 unpacked executable (PE machine 0x8664), received 0x${executableMachine.toString(16)}`,
  )
}

const launcher = await readFile(artifacts.launcher, 'utf8')
if (
  !launcher.startsWith('@echo off') ||
  !launcher.includes('ELECTRON_RUN_AS_NODE=1') ||
  !launcher.includes('ELECTRON_RUN_AS_NODE=') ||
  !launcher.includes('PICTOR_PACKAGE_ROOT') ||
  !launcher.includes('PICTOR_BUNDLED_PLUGINS_DIRECTORY') ||
  !launcher.includes('out\\cli\\src\\cli\\entry.js') ||
  !launcher.includes('out\\tui\\src\\tui\\entry.js') ||
  !launcher.includes('Pictor.exe')
) {
  throw new Error('Windows pictor.cmd does not expose the required GUI/CLI/TUI launcher contract')
}
const installerInclude = await readFile(
  resolve(repositoryRoot, 'packaging', 'windows', 'installer.nsh'),
  'utf8',
)
if (
  !installerInclude.includes('!macro customInstall') ||
  !installerInclude.includes('bin\\pictor.cmd')
) {
  throw new Error('Windows installer shortcuts do not enter the environment-clearing GUI launcher')
}

const archiveEntries = new Set(
  listPackage(artifacts.applicationArchive, { isPack: false }).map((entry) =>
    entry.replace(/^\/+/, '').replace(/\/$/, ''),
  ),
)
for (const entry of APP_ASAR_FRONTEND_ENTRIES) {
  if (!archiveEntries.has(entry)) throw new Error(`Missing app.asar frontend entry: ${entry}`)
}
const archivePackage = JSON.parse(
  extractFile(artifacts.applicationArchive, 'package.json').toString(),
)
const archiveIdentity = JSON.parse(
  extractFile(artifacts.applicationArchive, 'out/package-identity.json').toString(),
)
if (
  archivePackage.version !== packageMetadata.version ||
  archiveIdentity.version !== packageMetadata.version
) {
  throw new Error('Windows app.asar version identity is inconsistent')
}
if (
  archiveIdentity.buildChannel !== 'development' &&
  !/^[0-9a-f]{40}$/.test(archiveIdentity.sourceCommit ?? '')
) {
  throw new Error('Windows app.asar packaged identity has no exact source commit')
}

const pluginSizes = await verifyBundledPlugins(artifacts.bundledPlugins)
const fuses = await assertFuseWire(artifacts.executable, 'Windows Pictor.exe')
if (
  packageMetadata.build?.nsis?.createDesktopShortcut !== true ||
  packageMetadata.build?.nsis?.createStartMenuShortcut !== true
) {
  throw new Error('NSIS desktop and Start Menu shortcuts must remain enabled')
}

stdout.write(
  `${JSON.stringify(
    {
      verified: true,
      version: packageMetadata.version,
      architecture: 'x64',
      guiBinary: 'PE x64 Pictor.exe',
      launcher: 'bin/pictor.cmd',
      appAsar: {
        entries: APP_ASAR_FRONTEND_ENTRIES,
        buildChannel: archiveIdentity.buildChannel,
        sourceCommit: archiveIdentity.sourceCommit,
      },
      fuses,
      bundledPlugins: { count: BUNDLED_PLUGIN_IDS.length, manifestBytes: pluginSizes },
      artifacts: Object.fromEntries(
        Object.entries(sizes).map(([name, bytes]) => [
          name,
          { path: relative(repositoryRoot, artifacts[name]).replaceAll('\\', '/'), bytes },
        ]),
      ),
      shortcuts: { desktop: true, startMenu: true },
    },
    null,
    2,
  )}\n`,
)
