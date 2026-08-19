import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const [name, ...arguments_] = process.argv.slice(2)
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  throw new Error('Usage: npm run test:module -- <kebab-case-module> [vitest options]')
}

const moduleDirectory = resolve('src', 'modules', name)
if (!(await stat(moduleDirectory).catch(() => null))?.isDirectory()) {
  throw new Error(`Unknown Module directory: src/modules/${name}`)
}

const vitest = resolve('node_modules', 'vitest', 'vitest.mjs')
const child = spawn(process.execPath, [vitest, 'run', moduleDirectory, ...arguments_], {
  stdio: 'inherit',
})

child.once('error', (error) => {
  throw error
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})
