// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { expect, it } from 'vitest'

const repoRoot = resolve('.')
const pluginsRoot = resolve('plugins')
const srcRoot = resolve('src')
const kernelRoot = resolve('src/kernel')
const pluginCoreRoot = resolve('src/plugin')
const sdkRoot = resolve('packages/plugin-sdk')
const pilotRoot = resolve('plugins/pi-extension-host')

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
  return specifier.startsWith('.') ? resolve(dirname(file), specifier) : null
}

async function sourceFiles(root, includeTests = false) {
  return Promise.all(
    (await readdir(root, { recursive: true }))
      .filter(
        (file) => /\.(?:ts|tsx)$/.test(file) && (includeTests || !/\.test\.(?:ts|tsx)$/.test(file)),
      )
      .map(async (file) => {
        const absoluteFile = resolve(root, file)
        return { file: absoluteFile, source: await readFile(absoluteFile, 'utf8') }
      }),
  )
}

it('keeps production Plugins on the portable SDK instead of Core Kernel internals', async () => {
  const violations = []
  for (const { file, source } of await sourceFiles(pluginsRoot)) {
    for (const specifier of importsOf(source)) {
      const target = relativeTarget(file, specifier)
      if (target && (isWithin(kernelRoot, target) || isWithin(pluginCoreRoot, target))) {
        violations.push(`${relative(repoRoot, file)} imports ${specifier}`)
      }
    }
  }

  expect(violations).toEqual([])
})

it('keeps the Pi Extension Host pilot independent from Pictor source', async () => {
  const violations = []
  for (const { file, source } of await sourceFiles(pilotRoot, true)) {
    for (const specifier of importsOf(source)) {
      const target = relativeTarget(file, specifier)
      if (target && isWithin(srcRoot, target)) {
        violations.push(`${relative(repoRoot, file)} imports ${specifier}`)
      }
    }
  }

  expect(violations).toEqual([])
})

it('keeps the portable SDK independent from application and Plugin implementations', async () => {
  const violations = []
  for (const { file, source } of await sourceFiles(resolve(sdkRoot, 'src'))) {
    for (const specifier of importsOf(source)) {
      const target = relativeTarget(file, specifier)
      if (target && !isWithin(sdkRoot, target)) {
        violations.push(`${relative(repoRoot, file)} imports ${specifier}`)
      }
      if (/^(?:electron|react|react-dom)(?:\/|$)/.test(specifier)) {
        violations.push(`${relative(repoRoot, file)} imports ${specifier}`)
      }
    }
  }

  expect(violations).toEqual([])
})

it('keeps the Plugin scaffold on explicit private SDK subpaths', async () => {
  const generator = await readFile(resolve('scripts/create-plugin.mjs'), 'utf8')
  const packageMetadata = JSON.parse(
    await readFile(resolve('packages/plugin-sdk/package.json'), 'utf8'),
  )

  expect(generator).toContain("from '@pictor/plugin-sdk/module'")
  expect(generator).toContain("from '@pictor/plugin-sdk/plugin'")
  expect(generator).toContain("from '@pictor/plugin-sdk/manifest'")
  expect(generator).not.toMatch(/from ['"]\.\.\/\.\.\/src\/(?:kernel|plugin)/)
  expect(packageMetadata).toMatchObject({ name: '@pictor/plugin-sdk', private: true })
  expect(Object.hasOwn(packageMetadata.exports, '.')).toBe(false)
})
