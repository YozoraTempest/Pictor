import { rm, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
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

await rm(resolve(repositoryRoot, 'out'), { recursive: true, force: true })
await rm(resolve(repositoryRoot, '.pictor', 'bundled-plugins'), {
  recursive: true,
  force: true,
})

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const environment = { ...process.env, PICTOR_BUILD_CHANNEL: buildChannel }
if (sourceCommit === null) delete environment.PICTOR_SOURCE_COMMIT
else environment.PICTOR_SOURCE_COMMIT = sourceCommit

await run(process.execPath, ['scripts/build-plugins.mjs'], environment)
await run(process.execPath, ['scripts/build-cli.mjs'], environment)
await run(process.execPath, ['scripts/build-tui.mjs'], environment)
await run(command, ['run', 'build:gui'], environment)

await writeFile(
  resolve(repositoryRoot, 'out', 'package-identity.json'),
  `${JSON.stringify(
    {
      version: packageMetadata.version,
      buildChannel,
      sourceCommit,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

await run(process.execPath, ['scripts/verify-distribution-build.mjs'], environment)

async function run(executable, arguments_, environment) {
  const child = spawn(executable, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  })
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${executable} exited with signal ${signal}`))
        return
      }
      resolvePromise(code ?? 1)
    })
  })
  if (exitCode !== 0) throw new Error(`${executable} ${arguments_.join(' ')} failed: ${exitCode}`)
}
