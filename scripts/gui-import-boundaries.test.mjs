// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { expect, it } from 'vitest'

const productPlugins = ['workbench-delegate', 'gui-plugin-manager', 'updater', 'git-changes']
const repoRoot = resolve('.')
const pluginsRoot = resolve('plugins')
const srcRoot = resolve('src')
const guiRoot = resolve('src/gui')
const modulesRoot = resolve('src/modules')
const commandsRoot = resolve('src/commands')
const kernelRoot = resolve('src/kernel')
const pluginRoot = resolve('src/plugin')
const sharedRoot = resolve('src/shared')

const nodeBuiltins = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'module',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'timers',
  'url',
  'util',
  'worker_threads',
])

function isWithin(root, file) {
  const path = relative(root, file)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function sourceIsGui(file, source) {
  const name = basename(file)
  return (
    name.endsWith('.tsx') ||
    name === 'gui.ts' ||
    name === 'styles.ts' ||
    name === 'styles.css' ||
    /from\s+['"]\.\/(?:gui|styles)\.js['"]/.test(source)
  )
}

async function guiSources() {
  const sources = []
  for (const plugin of productPlugins) {
    const root = resolve(pluginsRoot, plugin)
    const files = await readdir(root, { recursive: true })
    for (const file of files) {
      const absoluteFile = resolve(root, file)
      if (!/\.(?:ts|tsx|css)$/.test(file)) continue
      const source = await readFile(absoluteFile, 'utf8')
      if (sourceIsGui(absoluteFile, source)) sources.push({ plugin, file: absoluteFile, source })
    }
  }
  return sources
}

function importsOf(source) {
  const imports = []
  const pattern = /\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g
  for (const [, specifier] of source.matchAll(pattern)) imports.push(specifier)
  return imports
}

function relativeImportTarget(file, specifier) {
  return specifier.startsWith('.') ? resolve(dirname(file), specifier) : null
}

function sourceTargetKind(target) {
  if (!target) return null
  if (isWithin(guiRoot, target)) return 'gui'
  if (isWithin(modulesRoot, target)) return 'modules'
  if (isWithin(commandsRoot, target)) return 'commands'
  if (isWithin(kernelRoot, target)) return 'kernel'
  if (isWithin(pluginRoot, target)) return 'plugin'
  if (isWithin(sharedRoot, target)) return 'shared'
  if (isWithin(srcRoot, target)) return 'other-src'
  return null
}

function stem(path) {
  return path.replace(/[?].*$/, '').replace(/\.[^.]+$/, '')
}

function validateImport(plugin, file, specifier) {
  if (specifier === 'electron' || specifier.startsWith('electron/')) {
    return 'Electron imports are not allowed'
  }
  if (specifier.startsWith('node:') || nodeBuiltins.has(specifier)) {
    return 'Node/process-specific imports are not allowed'
  }
  if (/(?:^|\/)src\/(?:renderer|main|preload|runtime)(?:\/|$)/.test(specifier)) {
    return 'process-specific Pictor implementation imports are not allowed'
  }

  const target = relativeImportTarget(file, specifier)
  if (!target) return null

  if (isWithin(pluginsRoot, target)) {
    const targetPlugin = relative(pluginsRoot, target).split(/[\\/]/)[0]
    if (targetPlugin !== plugin)
      return `private import from another product plugin (${targetPlugin})`
    return null
  }

  const kind = sourceTargetKind(target)
  if (kind === 'gui') {
    const name = stem(relative(guiRoot, target))
    return ['contract', 'plugin-style'].includes(name)
      ? null
      : 'private src/gui implementation imports are not allowed'
  }
  if (kind === 'modules') {
    return stem(relative(modulesRoot, target)).endsWith('/shared')
      ? null
      : 'only Headless/shared module contracts may be imported'
  }
  if (kind === 'commands') {
    const name = stem(relative(commandsRoot, target))
    return ['contract', 'index'].includes(name)
      ? null
      : 'only public command contracts may be imported'
  }
  if (kind === 'kernel') {
    const name = stem(relative(kernelRoot, target))
    return ['contract', 'module', 'kernel'].includes(name)
      ? null
      : 'only the public Module Kernel contract may be imported'
  }
  if (kind === 'plugin') {
    return stem(relative(pluginRoot, target)) === 'entry'
      ? null
      : 'only the public Plugin entry contract may be imported'
  }
  if (kind === 'shared') return null
  if (kind === 'other-src')
    return 'private or process-specific src implementation imports are not allowed'
  return null
}

it('keeps every product GUI plugin source and test on public frontend boundaries', async () => {
  const violations = []
  for (const { plugin, file, source } of await guiSources()) {
    for (const specifier of importsOf(source)) {
      const reason = validateImport(plugin, file, specifier)
      if (reason) violations.push(`${relative(repoRoot, file)} imports ${specifier}: ${reason}`)
    }
  }

  expect(violations).toEqual([])
})
