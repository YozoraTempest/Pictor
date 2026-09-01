import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { APP_ASAR_FRONTEND_ENTRIES, BUNDLED_PLUGIN_IDS } from './distribution-contract.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const outputRoot = resolve(repositoryRoot, 'out')
const bundledRoot = resolve(repositoryRoot, '.pictor', 'bundled-plugins')
const expectedPlugins = BUNDLED_PLUGIN_IDS
const requiredFiles = APP_ASAR_FRONTEND_ENTRIES.map((file) => file.replace(/^out\//, ''))

for (const file of requiredFiles) await requireFile(join(outputRoot, file))

const identity = JSON.parse(await readFile(join(outputRoot, 'package-identity.json'), 'utf8'))
if (identity.version !== packageMetadata.version) {
  throw new Error(`Distribution identity version ${identity.version} != ${packageMetadata.version}`)
}
if (!['development', 'stable', 'nightly'].includes(identity.buildChannel)) {
  throw new Error(`Invalid distribution build channel: ${identity.buildChannel}`)
}
if (
  identity.sourceCommit !== null &&
  (typeof identity.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(identity.sourceCommit))
) {
  throw new Error('Distribution identity sourceCommit must be null or a full lowercase SHA')
}
if (identity.buildChannel !== 'development' && identity.sourceCommit === null) {
  throw new Error('Stable and Nightly distribution identities require a sourceCommit')
}

const pluginDirectories = (await readdir(bundledRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted()
if (JSON.stringify(pluginDirectories) !== JSON.stringify([...expectedPlugins].toSorted())) {
  throw new Error(
    `Expected exactly 10 bundled Plugins, received ${pluginDirectories.length}: ${pluginDirectories.join(', ')}`,
  )
}

for (const id of expectedPlugins) {
  const packageRoot = join(bundledRoot, id)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
  if (manifest.id !== id || manifest.version !== packageMetadata.version) {
    throw new Error(`Bundled Plugin identity mismatch: ${relative(repositoryRoot, packageRoot)}`)
  }
  await requireFile(join(packageRoot, 'package.json'))
  for (const [processName, entry] of Object.entries(manifest.modules ?? {})) {
    if (!['host', 'gui', 'tui', 'runtime'].includes(processName)) {
      throw new Error(`Unsupported bundled Module ${processName} in ${id}`)
    }
    if (typeof entry !== 'string') throw new Error(`Invalid bundled entry ${id}:${processName}`)
    await requireFile(join(packageRoot, entry))
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      verified: true,
      version: packageMetadata.version,
      buildChannel: identity.buildChannel,
      sourceCommit: identity.sourceCommit,
      frontends: ['gui', 'cli', 'tui'],
      bundledPlugins: expectedPlugins.length,
    },
    null,
    2,
  )}\n`,
)

async function requireFile(path) {
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isFile() || metadata.size === 0) {
    throw new Error(`Expected a non-empty distribution file: ${relative(repositoryRoot, path)}`)
  }
}
