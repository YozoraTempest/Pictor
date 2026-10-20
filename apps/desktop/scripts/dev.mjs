import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  logLevel: 'info',
  sourcemap: true,
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
const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
})
await server.listen()
const url = server.resolvedUrls?.local[0]
if (url === undefined) throw new Error('vite dev server did not expose a local URL')

const electronBinary = fileURLToPath(
  new URL('../../../node_modules/electron/cli.js', import.meta.url),
)
const child = spawn(process.execPath, [electronBinary, '.'], {
  cwd: appRoot,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: url },
})

const shutdown = async () => {
  await server.close()
  if (!child.killed) child.kill()
}

child.on('exit', () => {
  void shutdown().finally(() => process.exit(0))
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0))
  })
}
