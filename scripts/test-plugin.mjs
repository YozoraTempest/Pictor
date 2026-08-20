import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const [name, ...arguments_] = process.argv.slice(2)
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  throw new Error('Usage: npm run test:plugin -- <kebab-case-plugin|host> [vitest options]')
}

const targets =
  name === 'host'
    ? ['src/plugin', 'src/main/plugins/plugin-store.test.ts']
    : [resolve('plugins', name)]

for (const target of targets) {
  if (!(await stat(target).catch(() => null))) {
    throw new Error(`Unknown Plugin test target: ${target}`)
  }
}

const vitest = resolve('node_modules', 'vitest', 'vitest.mjs')
const child = spawn(process.execPath, [vitest, 'run', ...targets, ...arguments_], {
  stdio: 'inherit',
})

child.once('error', (error) => {
  throw error
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})
