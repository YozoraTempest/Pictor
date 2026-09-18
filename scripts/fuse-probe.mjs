import { spawn } from 'node:child_process'
import process from 'node:process'

export function runProbe(
  executable,
  arguments_,
  environment,
  { cwd = process.cwd(), timeoutMs = 5_000 } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = globalThis.setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      globalThis.clearTimeout(timer)
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      globalThis.clearTimeout(timer)
      resolvePromise({ exitCode, signal, timedOut, stdout, stderr })
    })
  })
}
