import { watch } from 'node:fs'
import {
  access,
  appendFile,
  cp,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'

import { build } from 'vite'

const sourceRoot = resolve('plugins')
const sdkRoot = resolve('packages/plugin-sdk')
const outputRoot = resolve(process.env.PICTOR_BUNDLED_PLUGINS_OUTPUT ?? '.pictor/bundled-plugins')
const processNames = ['host', 'gui', 'tui', 'runtime']
const watchMode = process.argv.includes('--watch')
const skipInitial = process.argv.includes('--skip-initial')

if (!skipInitial) await buildPlugins()
if (watchMode) await watchPlugins()

async function buildPlugins() {
  const stagingRoot = `${outputRoot}.staging-${process.pid}-${Date.now()}`
  await rm(stagingRoot, { recursive: true, force: true })
  try {
    await buildPluginsInto(stagingRoot)
    await replaceDirectory(stagingRoot, outputRoot)
    globalThis.console.log(`[plugins] built ${outputRoot}`)
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

async function buildPluginsInto(targetRoot) {
  await mkdir(targetRoot, { recursive: true })

  const directories = await readdir(sourceRoot, { withFileTypes: true })
  for (const directory of directories.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!directory.isDirectory()) continue
    const pluginRoot = join(sourceRoot, directory.name)
    const manifestPath = join(pluginRoot, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest.id !== 'string') throw new Error(`Invalid Plugin Manifest: ${manifestPath}`)
    const moduleKeys = Object.keys(manifest.modules ?? {})
    if (moduleKeys.some((key) => !processNames.includes(key))) {
      throw new Error(`Plugin Manifest uses an unsupported Module key: ${manifestPath}`)
    }

    const packageRoot = join(targetRoot, manifest.id)
    const distRoot = join(packageRoot, 'dist')
    await mkdir(distRoot, { recursive: true })
    await writeFile(join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n')

    for (const processName of processNames) {
      const manifestEntry = manifest.modules?.[processName]
      if (!manifestEntry) continue
      const sourceEntry = await sourceEntryPath(pluginRoot, processName, manifestPath)
      const outputName = basename(manifestEntry)
      const gui = processName === 'gui'
      const runtime = processName === 'runtime'
      const nodeProcess = processName !== 'gui'
      await build({
        configFile: false,
        logLevel: 'warn',
        plugins: runtime ? [bundledPiExtensionModules()] : [],
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        ...(nodeProcess ? { ssr: { noExternal: true } } : {}),
        build: {
          ...(nodeProcess ? { ssr: true } : {}),
          target: 'es2023',
          outDir: distRoot,
          emptyOutDir: false,
          minify: false,
          lib: {
            entry: sourceEntry,
            name: gui ? '__pictorPluginBundle' : undefined,
            formats: [gui ? 'iife' : 'es'],
            fileName: () => outputName.replace(/\.js$/, ''),
          },
          rollupOptions: {
            external: gui ? ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'] : [],
            output: gui
              ? {
                  format: 'iife',
                  name: '__pictorPluginBundle',
                  inlineDynamicImports: true,
                  entryFileNames: outputName,
                  globals: {
                    react: '__PICTOR_REACT__',
                    'react/jsx-runtime': '__PICTOR_JSX_RUNTIME__',
                    'react/jsx-dev-runtime': '__PICTOR_JSX_DEV_RUNTIME__',
                  },
                }
              : {
                  inlineDynamicImports: true,
                  entryFileNames: outputName,
                  ...(runtime
                    ? {
                        banner:
                          "import { createRequire as __pictorCreateRequire } from 'node:module'; import { fileURLToPath as __pictorFileURLToPath } from 'node:url'; import { dirname as __pictorDirname } from 'node:path'; const require = __pictorCreateRequire(import.meta.url); const __filename = __pictorFileURLToPath(import.meta.url); const __dirname = __pictorDirname(__filename);",
                      }
                    : {}),
                },
          },
        },
      })
      if (gui) {
        await appendFile(join(distRoot, outputName), '\nexport default __pictorPluginBundle;\n')
      }
      if (runtime && manifest.id === 'pictor.pi-agent-runtime') {
        await copyFile(
          resolve(
            'node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
          ),
          join(distRoot, 'photon_rs_bg.wasm'),
        )
        await cp(
          resolve('node_modules/@earendil-works/pi-coding-agent/dist/core/export-html'),
          join(distRoot, 'core', 'export-html'),
          { recursive: true },
        )
        const themeRoot = join(distRoot, 'modes', 'interactive', 'theme')
        await mkdir(themeRoot, { recursive: true })
        for (const theme of ['dark.json', 'light.json']) {
          await copyFile(
            resolve(
              'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme',
              theme,
            ),
            join(themeRoot, theme),
          )
        }
      }
    }

    for (const resourceDirectory of ['assets', 'pi']) {
      const source = join(pluginRoot, resourceDirectory)
      const exists = await readdir(source).catch(() => null)
      if (exists) await cp(source, join(packageRoot, resourceDirectory), { recursive: true })
    }

    await verifyBundledPackage(packageRoot, manifest)
  }
}

async function watchPlugins() {
  let timer
  let building = false
  let pending = false

  const runPendingBuild = async () => {
    if (building) {
      pending = true
      return
    }
    building = true
    do {
      pending = false
      try {
        await buildPlugins()
        await requestCreationModeReload('Bundled Plugins rebuilt')
      } catch (error) {
        globalThis.console.error(
          '[plugins] build failed; keeping the previous runnable output',
          error,
        )
      }
    } while (pending)
    building = false
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void runPendingBuild(), 160)
  }
  const watchers = [sourceRoot, sdkRoot].map((root) => watch(root, { recursive: true }, schedule))
  globalThis.console.log('[plugins] watching plugin and SDK sources')

  await new Promise((resolvePromise, reject) => {
    for (const watcher of watchers) watcher.once('error', reject)
    const stop = () => {
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      resolvePromise()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

async function requestCreationModeReload(reason) {
  const triggerPath = process.env.PICTOR_WEB_CREATION_TRIGGER
  if (!triggerPath) return
  await mkdir(dirname(triggerPath), { recursive: true })
  await writeFile(triggerPath, `${new Date().toISOString()} ${reason}\n`, 'utf8')
}

async function replaceDirectory(stagingRoot, targetRoot) {
  const backupRoot = `${targetRoot}.previous-${process.pid}`
  await mkdir(dirname(targetRoot), { recursive: true })
  await rm(backupRoot, { recursive: true, force: true })
  const hadPrevious = await rename(targetRoot, backupRoot).then(
    () => true,
    (error) => {
      if (error?.code === 'ENOENT') return false
      throw error
    },
  )
  try {
    await rename(stagingRoot, targetRoot)
  } catch (error) {
    if (hadPrevious) await rename(backupRoot, targetRoot)
    throw error
  }
  if (hadPrevious) await rm(backupRoot, { recursive: true, force: true })
}

function bundledPiExtensionModules() {
  return {
    name: 'pictor-bundled-pi-extension-modules',
    transform(code, id) {
      if (!id.endsWith('/pi-coding-agent/dist/core/extensions/loader.js')) return null
      return code.replace(
        /const isTypeScriptSourceRuntime = [^;]+;/,
        'const isTypeScriptSourceRuntime = true;',
      )
    },
  }
}

async function sourceEntryPath(pluginRoot, processName, manifestPath) {
  for (const extension of ['.ts', '.tsx']) {
    const candidate = join(pluginRoot, `${processName}${extension}`)
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate
  }
  throw new Error(`Missing ${processName} entry for ${manifestPath}`)
}

async function verifyBundledPackage(packageRoot, manifest) {
  for (const legacyEntry of ['main.js', 'renderer.js']) {
    const entryPath = join(packageRoot, 'dist', legacyEntry)
    if (await stat(entryPath).catch(() => null))
      throw new Error(`Bundled Plugin contains a legacy dist entry: ${entryPath}`)
  }
  for (const [processName, manifestEntry] of Object.entries(manifest.modules ?? {})) {
    if (typeof manifestEntry !== 'string') {
      throw new Error(`Invalid ${processName} entry in ${join(packageRoot, 'manifest.json')}`)
    }
    const entryPath = join(packageRoot, manifestEntry)
    const entryStat = await stat(entryPath).catch(() => null)
    if (!entryStat?.isFile()) throw new Error(`Missing Bundled Plugin entry: ${entryPath}`)
    const entrySource = await readFile(entryPath, 'utf8')
    if (/['"]@pictor\/plugin-sdk(?:\/|['"])/.test(entrySource)) {
      throw new Error(`Bundled Plugin contains an unresolved Plugin SDK import: ${entryPath}`)
    }
  }
}
