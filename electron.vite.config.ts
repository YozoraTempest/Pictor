import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const buildChannel = process.env.PICTOR_BUILD_CHANNEL ?? 'development'
const sourceCommit = process.env.PICTOR_SOURCE_COMMIT ?? null

if (!['development', 'stable', 'nightly'].includes(buildChannel)) {
  throw new Error(`Unsupported PICTOR_BUILD_CHANNEL: ${buildChannel}`)
}
if (sourceCommit !== null && !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error('PICTOR_SOURCE_COMMIT must be a full lowercase Git commit SHA')
}
if (buildChannel !== 'development' && sourceCommit === null) {
  throw new Error('PICTOR_SOURCE_COMMIT is required for packaged build channels')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __PICTOR_BUILD_CHANNEL__: JSON.stringify(buildChannel),
      __PICTOR_SOURCE_COMMIT__: JSON.stringify(sourceCommit),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'runtime/host': resolve('src/runtime/host.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
})
