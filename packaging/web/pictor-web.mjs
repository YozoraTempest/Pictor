#!/usr/bin/env node

import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = resolve(packageRoot, 'out/web-host/src/web-host/entry.js')
const bundledPluginsDirectory = resolve(packageRoot, 'bundled-plugins')

await requirePath(entryPath, 'Pictor Web Host entry')
await requirePath(bundledPluginsDirectory, 'Pictor Bundled Plugin directory')

process.env.PICTOR_PACKAGED = '1'
process.env.PICTOR_FRONTEND = 'web'
process.env.PICTOR_PACKAGE_ROOT = packageRoot
process.env.PICTOR_BUNDLED_PLUGINS_DIRECTORY = bundledPluginsDirectory
process.env.PICTOR_INSTALLATION_ROOT = packageRoot

const { main } = await import(pathToFileURL(entryPath).href)
process.exitCode = await main(process.argv.slice(2))

async function requirePath(path, label) {
  try {
    await access(path)
  } catch (cause) {
    throw new Error(`${label} is missing: ${path}`, { cause })
  }
}
