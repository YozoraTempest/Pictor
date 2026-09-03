// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { expect, it } from 'vitest'

const repoRoot = resolve('.')
const tuiRoot = resolve('src/tui')
const tuiPluginRoot = resolve('plugins/tui-delegate')
const srcRoot = resolve('src')
const pluginsRoot = resolve('plugins')

function isWithin(root, file) {
  const path = relative(root, file)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function importsOf(source) {
  const imports = []
  const pattern = /\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g
  for (const [, specifier] of source.matchAll(pattern)) imports.push(specifier)
  return imports
}

function relativeTarget(file, specifier) {
  if (!specifier.startsWith('.')) return null
  return resolve(dirname(file), specifier)
}

function validateCoreImport(file, specifier) {
  if (/^(?:electron|react|react-dom)(?:\/|$)/.test(specifier)) {
    return 'TUI Core must not depend on Electron, React, or DOM rendering'
  }
  if (specifier === 'child_process' || specifier === 'node:child_process') {
    return 'TUI must not launch child processes'
  }
  if (/(?:^|\/)src\/(?:main|preload|renderer|gui)(?:\/|$)/.test(specifier)) {
    return 'TUI Core must use public Headless/Frontend contracts'
  }
  const target = relativeTarget(file, specifier)
  if (!target) return null
  if (isWithin(resolve('src/gui'), target) || isWithin(resolve('src/renderer'), target)) {
    return 'TUI Core must not import GUI/private renderer implementations'
  }
  if (isWithin(pluginsRoot, target)) return 'TUI Core must not import a product Plugin directly'
  return null
}

function validatePluginImport(plugin, file, specifier) {
  if (/^(?:electron|react|react-dom)(?:\/|$)/.test(specifier)) {
    return 'TUI Plugin must not depend on Electron, React, or DOM rendering'
  }
  if (specifier.startsWith('node:') || specifier === 'child_process') {
    return 'TUI Plugin must not depend on Node process implementation details'
  }
  if (/(?:^|\/)src\/(?:main|preload|renderer|gui|runtime)(?:\/|$)/.test(specifier)) {
    return 'TUI Plugin must use public contracts instead of process/private implementations'
  }
  const target = relativeTarget(file, specifier)
  if (!target) return null
  if (isWithin(pluginsRoot, target)) {
    const targetPlugin = relative(pluginsRoot, target).split(/[\\/]/)[0]
    if (targetPlugin !== plugin) return `cross-Plugin private import: ${targetPlugin}`
  }
  if (isWithin(srcRoot, target)) {
    const allowed = [
      isWithin(resolve('src/tui'), target),
      isWithin(resolve('src/modules/agent-workspace'), target) &&
        basename(target).startsWith('shared.'),
      isWithin(resolve('src/shared'), target),
      isWithin(resolve('src/kernel'), target) &&
        ['module.js', 'contract.js', 'kernel.js'].includes(basename(target)),
      isWithin(resolve('src/plugin'), target) && basename(target) === 'entry.js',
    ]
    if (!allowed.some(Boolean)) return 'private Pictor source import'
  }
  return null
}

async function sourceFiles(root) {
  return Promise.all(
    (await readdir(root, { recursive: true }))
      .filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.test\.(?:ts|tsx)$/.test(file))
      .map(async (file) => {
        const absoluteFile = resolve(root, file)
        return { file: absoluteFile, source: await readFile(absoluteFile, 'utf8') }
      }),
  )
}

async function resolveLocalSource(file, specifier) {
  const target = relativeTarget(file, specifier)
  if (!target) return null
  const candidates = [
    target,
    target.replace(/\.js$/, '.ts'),
    target.replace(/\.js$/, '.tsx'),
    `${target}.ts`,
    `${target}.tsx`,
  ]
  for (const candidate of candidates) {
    try {
      await readFile(candidate)
      return candidate
    } catch {
      // Keep resolving the source graph without requiring emitted JavaScript.
    }
  }
  return null
}

async function transitiveProductionSources() {
  const pending = await sourceFiles(tuiRoot)
  const visited = new Map(pending.map(({ file, source }) => [file, source]))
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    for (const specifier of importsOf(current.source)) {
      const target = await resolveLocalSource(current.file, specifier)
      if (!target || !isWithin(srcRoot, target) || visited.has(target)) continue
      const source = await readFile(target, 'utf8')
      visited.set(target, source)
      pending.push({ file: target, source })
    }
  }
  return visited
}

it('keeps TUI Core and Delegate Plugin on public non-GUI boundaries', async () => {
  const violations = []
  for (const { file, source } of await sourceFiles(tuiRoot)) {
    for (const specifier of importsOf(source)) {
      const reason = validateCoreImport(file, specifier)
      if (reason) violations.push(`${relative(repoRoot, file)} imports ${specifier}: ${reason}`)
    }
  }
  for (const { file, source } of await sourceFiles(tuiPluginRoot)) {
    for (const specifier of importsOf(source)) {
      const reason = validatePluginImport('tui-delegate', file, specifier)
      if (reason) violations.push(`${relative(repoRoot, file)} imports ${specifier}: ${reason}`)
    }
  }
  expect(violations).toEqual([])
})

it('keeps the production Pi composition on the public InteractiveMode runner seam', async () => {
  const source = await readFile(resolve('src/runtime/pi-adapter.ts'), 'utf8')
  expect(source).toContain('new InteractiveMode(runtime, options)')
  expect(source).toContain('modeFactory(createInteractiveRuntimeAdapter(runtime), modeOptions)')
  expect(source).toContain('return this.mode.run()')
  expect(source).not.toMatch(/as\s+any/)
})

it('keeps ModelConnectionTester in the Application boundary transitively', async () => {
  const applicationSource = await readFile(resolve('src/application/model-connection.ts'), 'utf8')
  const mainSource = await readFile(resolve('src/main/model-connection.ts'), 'utf8')
  const tuiConfig = JSON.parse(await readFile(resolve('tsconfig.tui.json'), 'utf8'))
  const graph = await transitiveProductionSources()

  expect(applicationSource).not.toMatch(/(?:from|import)\s+['"][^'"]*(?:src\/main|\.\.\/main)/)
  expect(mainSource).toContain(
    "export { ModelConnectionTester } from '../application/model-connection.js'",
  )
  expect(tuiConfig.include).not.toContain('src/main/model-connection.ts')
  expect(graph.has(resolve('src/main/model-connection.ts'))).toBe(false)
})
