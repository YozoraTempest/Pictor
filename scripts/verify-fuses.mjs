import { randomUUID } from 'node:crypto'
import { chmod, copyFile, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses'

import { assertFuseWire } from './electron-fuses.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const binaryPaths = process.argv.slice(2).map((path) => resolve(repositoryRoot, path))
if (binaryPaths.length === 0) {
  binaryPaths.push(
    process.platform === 'win32'
      ? resolve(repositoryRoot, 'dist', 'win-unpacked', 'Pictor.exe')
      : resolve(repositoryRoot, 'dist', 'linux-unpacked', 'pictor-gui'),
  )
}

const evidence = []
for (const binaryPath of binaryPaths) {
  const fuseWire = await assertFuseWire(binaryPath, `Fuse binary ${basename(binaryPath)}`)
  const launcherProbe = await probeRunAsNodeDependency(binaryPath)
  evidence.push({ binaryPath, fuseWire, launcherProbe })
}

process.stdout.write(
  `${JSON.stringify(
    {
      verified: true,
      version: packageMetadata.version,
      binaries: evidence,
      note: 'A copied binary with runAsNode disabled did not execute the packaged CLI entry.',
    },
    null,
    2,
  )}\n`,
)

async function probeRunAsNodeDependency(binaryPath) {
  const probeBinary = join(
    dirname(binaryPath),
    `.pictor-fuse-probe-${randomUUID()}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  try {
    await copyFile(binaryPath, probeBinary)
    await chmod(probeBinary, 0o755)
    await flipFuses(probeBinary, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
    })
    const appRoot = resolve(dirname(binaryPath), 'resources', 'app.asar')
    const bundledPlugins = resolve(dirname(binaryPath), 'resources', 'bundled-plugins')
    const entry = `${appRoot}/out/cli/src/cli/entry.js`
    const result = await runProbe(probeBinary, [entry, '--help'], {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PICTOR_PACKAGED: '1',
      PICTOR_PACKAGE_ROOT: appRoot,
      PICTOR_BUNDLED_PLUGINS_DIRECTORY: bundledPlugins,
    })
    if (result.stdout.includes('Usage: pictor cli')) {
      throw new Error('A runAsNode-disabled binary unexpectedly executed the CLI entry')
    }
    if (!result.timedOut && result.exitCode === 0) {
      throw new Error('A runAsNode-disabled binary exited successfully at the CLI entry')
    }
    return result
  } finally {
    await rm(probeBinary, { force: true })
  }
}

function runProbe(executable, arguments_, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = globalThis.setTimeout(() => {
      timedOut = true
      child.kill()
    }, 5_000)
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
    child.once('exit', (exitCode, signal) => {
      globalThis.clearTimeout(timer)
      resolvePromise({ exitCode, signal, timedOut, stdout, stderr })
    })
  })
}
