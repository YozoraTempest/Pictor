import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Main and preload are bundled with esbuild so workspace TypeScript packages are
 * always inlined; Vite's SSR pipeline would otherwise externalise them because
 * they are listed as dependencies.
 */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
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
