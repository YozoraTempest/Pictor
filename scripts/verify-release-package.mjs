import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const scripts = ['package:verify', 'package:verify:fuses']
if (process.platform === 'win32') {
  scripts.push(
    'package:verify:windows:launch',
    'package:verify:windows:install',
    'package:verify:profile',
    'package:verify:recovery',
  )
} else if (process.platform === 'linux') {
  scripts.push('package:verify:linux:launch')
  await run('package:verify:linux:launch', {
    PICTOR_LINUX_EXECUTABLE: resolve(
      repositoryRoot,
      'dist',
      `Pictor-${packageMetadata.version}-linux-x64.AppImage`,
    ),
  })
  scripts.push('package:verify:profile', 'package:verify:recovery')
} else {
  throw new Error(`Release package verification is not supported on ${process.platform}`)
}

for (const script of scripts) await run(script)

async function run(script, extraEnvironment = {}) {
  const child = spawn(npm, ['run', script], {
    cwd: repositoryRoot,
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
  })
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${script} exited with signal ${signal}`))
        return
      }
      resolvePromise(code ?? 1)
    })
  })
  if (exitCode !== 0) throw new Error(`${script} failed with exit code ${exitCode}`)
}
