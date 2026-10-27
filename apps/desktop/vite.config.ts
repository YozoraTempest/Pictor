import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    // The harness package's subpaths resolve to source, the same way its siblings do:
    // the renderer is bundled, not run against `node_modules`.
    alias: [
      {
        find: '@vulonlok/shared',
        replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
      {
        find: /^@vulonlok\/ui(\/|$)/,
        replacement: fileURLToPath(new URL('../../packages/ui/src/', import.meta.url)),
      },
      {
        find: /^@vulonlok\/harness\//,
        replacement: fileURLToPath(new URL('../../packages/harness/src/', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL('./out/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
