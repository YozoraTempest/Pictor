import { extractFile, listPackage } from '@electron/asar'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'

import { APP_ASAR_FRONTEND_ENTRIES, BUNDLED_PLUGIN_IDS } from './distribution-contract.mjs'

export async function verifyApplicationArchive(archivePath, expectedVersion, label) {
  const entries = new Set(
    listPackage(archivePath, { isPack: false }).map((entry) =>
      entry.replace(/^\/+/, '').replace(/\/$/, ''),
    ),
  )
  for (const entry of APP_ASAR_FRONTEND_ENTRIES) {
    if (!entries.has(entry)) throw new Error(`${label} is missing app.asar entry ${entry}`)
  }

  const packageMetadata = readArchiveJson(archivePath, 'package.json')
  const identity = readArchiveJson(archivePath, 'out/package-identity.json')
  if (packageMetadata.version !== expectedVersion || identity.version !== expectedVersion) {
    throw new Error(`${label} app.asar contains inconsistent version identity`)
  }
  if (
    !['development', 'stable', 'nightly'].includes(identity.buildChannel) ||
    (identity.buildChannel !== 'development' && !/^[0-9a-f]{40}$/.test(identity.sourceCommit ?? ''))
  ) {
    throw new Error(`${label} app.asar contains an invalid packaged identity`)
  }
  return {
    entries: APP_ASAR_FRONTEND_ENTRIES,
    buildChannel: identity.buildChannel,
    sourceCommit: identity.sourceCommit,
  }
}

export async function verifyBundledPlugins(root, expectedVersion, label) {
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
  if (JSON.stringify(directories) !== JSON.stringify([...BUNDLED_PLUGIN_IDS].toSorted())) {
    throw new Error(
      `${label} expected exactly 10 Bundled Plugins, received ${directories.join(', ')}`,
    )
  }

  const manifestBytes = {}
  for (const id of BUNDLED_PLUGIN_IDS) {
    const packageRoot = join(root, id)
    const manifestPath = join(packageRoot, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.id !== id || manifest.version !== expectedVersion) {
      throw new Error(`${label} Bundled Plugin identity mismatch: ${id}`)
    }
    manifestBytes[id] = (await stat(manifestPath)).size
    await requireNonEmptyFile(join(packageRoot, 'package.json'), `${label} ${id}/package.json`)
    for (const [processName, entry] of Object.entries(manifest.modules ?? {})) {
      if (!['host', 'gui', 'tui', 'runtime'].includes(processName) || typeof entry !== 'string') {
        throw new Error(`${label} invalid ${id} ${processName} entry`)
      }
      await requireNonEmptyFile(join(packageRoot, entry), `${label} ${id}/${entry}`)
    }
  }
  return { count: BUNDLED_PLUGIN_IDS.length, manifestBytes }
}

export function readArchiveJson(archivePath, entry) {
  return JSON.parse(extractFile(archivePath, entry).toString())
}

export async function requireNonEmptyFile(path, label = path) {
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isFile() || metadata.size === 0) {
    throw new Error(`Expected a non-empty file: ${label} (${relative(process.cwd(), path)})`)
  }
  return metadata.size
}
