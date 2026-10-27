import { existsSync } from 'node:fs'

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Main and preload are bundled with esbuild so workspace TypeScript packages are
 * always inlined; Vite's SSR pipeline would otherwise externalise them because
 * they are listed as dependencies.
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Resolves the harness package's subpaths for esbuild.
 *
 * The main and preload bundles inline workspace TypeScript, and esbuild does not read a
 * package's `exports` map — so `@vulonlok/harness/main/...` is pointed at its source here,
 * the same way a sibling package's index is. This is deliberate: one shell, one harness,
 * shipped together. A harness distributed on its own would have to be built to JS first.
 */
const harnessPackage = {
  name: 'workspace-harness',
  setup(build) {
    build.onResolve({ filter: /^@vulonlok\/harness\// }, (args) => {
      const tail = args.path.slice('@vulonlok/harness/'.length)
      // A directory entry (`preload`) is its own index; anything else is a module file.
      const base = `${repoRoot}/packages/harness/src/${tail}`
      const file = ['.ts', '/index.ts']
        .map((suffix) => base + suffix)
        .find((path) => existsSync(path))
      return file === undefined ? undefined : { path: file }
    })
  },
}

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  plugins: [harnessPackage],
  external: ['electron', '@earendil-works/pi-coding-agent', 'ws'],
  logLevel: 'info',
  sourcemap: false,
  minify: false,
}

await build({
  ...shared,
  entryPoints: [fileURLToPath(new URL('../src/main/index.ts', import.meta.url))],
  format: 'esm',
  outfile: fileURLToPath(new URL('../out/main/index.js', import.meta.url)),
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})

await build({
  ...shared,
  entryPoints: [fileURLToPath(new URL('../src/preload/index.ts', import.meta.url))],
  format: 'cjs',
  outfile: fileURLToPath(new URL('../out/preload/index.cjs', import.meta.url)),
})

process.chdir(appRoot)
await viteBuild({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) })
