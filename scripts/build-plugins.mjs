import { appendFile, cp, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { build } from 'vite'

const sourceRoot = resolve('plugins')
const outputRoot = resolve('.pictor', 'bundled-plugins')
const processNames = ['main', 'renderer', 'runtime']

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const directories = await readdir(sourceRoot, { withFileTypes: true })
for (const directory of directories.toSorted((left, right) =>
  left.name.localeCompare(right.name),
)) {
  if (!directory.isDirectory()) continue
  const pluginRoot = join(sourceRoot, directory.name)
  const manifestPath = join(pluginRoot, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (typeof manifest.id !== 'string') throw new Error(`Invalid Plugin Manifest: ${manifestPath}`)

  const packageRoot = join(outputRoot, manifest.id)
  const distRoot = join(packageRoot, 'dist')
  await mkdir(distRoot, { recursive: true })
  await writeFile(join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n')

  for (const processName of processNames) {
    const manifestEntry = manifest.modules?.[processName]
    if (!manifestEntry) continue
    const sourceEntry = join(pluginRoot, `${processName}.ts`)
    const outputName = basename(manifestEntry)
    const renderer = processName === 'renderer'
    const runtime = processName === 'runtime'
    await build({
      configFile: false,
      logLevel: 'warn',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      ...(runtime ? { ssr: { noExternal: true } } : {}),
      build: {
        ...(runtime ? { ssr: true } : {}),
        target: 'es2023',
        outDir: distRoot,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: sourceEntry,
          name: renderer ? '__pictorPluginBundle' : undefined,
          formats: [renderer ? 'iife' : 'es'],
          fileName: () => outputName.replace(/\.js$/, ''),
        },
        rollupOptions: {
          external: renderer
            ? ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']
            : processName === 'main'
              ? ['electron']
              : [],
          output: renderer
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
    if (renderer) {
      await appendFile(join(distRoot, outputName), '\nexport default __pictorPluginBundle;\n')
    }
    if (runtime && manifest.id === 'pictor.pi-agent-runtime') {
      await copyFile(
        resolve(
          'node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
        ),
        join(distRoot, 'photon_rs_bg.wasm'),
      )
    }
  }

  for (const resourceDirectory of ['assets', 'pi']) {
    const source = join(pluginRoot, resourceDirectory)
    const exists = await readdir(source).catch(() => null)
    if (exists) await cp(source, join(packageRoot, resourceDirectory), { recursive: true })
  }
}
