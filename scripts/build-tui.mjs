import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'

const outputDirectory = resolve('out', 'tui')
const compilerScript = resolve('node_modules', 'typescript', 'bin', 'tsc')

await rm(outputDirectory, { recursive: true, force: true })

const compilerProcess = spawn(process.execPath, [compilerScript, '-p', 'tsconfig.tui.json'], {
  stdio: 'inherit',
})

const compilerExitCode = await new Promise((resolvePromise, reject) => {
  compilerProcess.once('error', reject)
  compilerProcess.once('exit', (code, signal) => {
    if (signal) {
      reject(new Error(`TypeScript compiler exited with signal ${signal}`))
      return
    }
    resolvePromise(code ?? 1)
  })
})

if (compilerExitCode !== 0) process.exitCode = compilerExitCode
