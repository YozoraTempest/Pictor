import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distributionRoot = resolve(repositoryRoot, 'dist')
const stagingRoot = resolve(distributionRoot, 'web-package')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(resolve(repositoryRoot, 'package-lock.json'), 'utf8'))
const buildChannel = process.env.PICTOR_BUILD_CHANNEL ?? 'development'
const sourceCommit = process.env.PICTOR_SOURCE_COMMIT ?? null

validateIdentity(buildChannel, sourceCommit)

const artifactName = `Pictor-${packageMetadata.version}-web.tgz`
const artifactPath = resolve(distributionRoot, artifactName)
const generatedPackage = {
  name: '@yozoratempest/pictor-web',
  version: packageMetadata.version,
  private: true,
  description: 'Pictor local Web Host and browser frontend',
  license: packageMetadata.license,
  author: packageMetadata.author,
  repository: packageMetadata.repository,
  homepage: packageMetadata.homepage,
  bugs: packageMetadata.bugs,
  type: 'module',
  engines: packageMetadata.engines,
  bin: { 'pictor-web': 'bin/pictor-web.mjs' },
  scripts: { start: 'node bin/pictor-web.mjs' },
  dependencies: exactRuntimeDependencies(packageMetadata.dependencies, packageLock),
}

await rm(stagingRoot, { recursive: true, force: true })
await rm(artifactPath, { force: true })
await mkdir(resolve(stagingRoot, 'bin'), { recursive: true })
await mkdir(resolve(stagingRoot, 'out'), { recursive: true })

await Promise.all([
  cp(resolve(repositoryRoot, 'out/web'), resolve(stagingRoot, 'out/web'), { recursive: true }),
  cp(resolve(repositoryRoot, 'out/web-host'), resolve(stagingRoot, 'out/web-host'), {
    recursive: true,
  }),
  cp(resolve(repositoryRoot, '.pictor/bundled-plugins'), resolve(stagingRoot, 'bundled-plugins'), {
    recursive: true,
  }),
  cp(
    resolve(repositoryRoot, 'packaging/web/pictor-web.mjs'),
    resolve(stagingRoot, 'bin/pictor-web.mjs'),
  ),
  cp(resolve(repositoryRoot, 'LICENSE'), resolve(stagingRoot, 'LICENSE')),
  cp(resolve(repositoryRoot, 'README.md'), resolve(stagingRoot, 'README.md')),
])

await writeFile(
  resolve(stagingRoot, 'package.json'),
  `${JSON.stringify(generatedPackage, null, 2)}\n`,
  'utf8',
)
await writeFile(
  resolve(stagingRoot, 'out/package-identity.json'),
  `${JSON.stringify({ version: packageMetadata.version, buildChannel, sourceCommit }, null, 2)}\n`,
  'utf8',
)

const packed = JSON.parse(
  await runNpm(['pack', '--json', '--pack-destination', distributionRoot], stagingRoot),
)
const packedFilename = packed[0]?.filename
if (typeof packedFilename !== 'string') {
  throw new Error('npm pack did not report the generated Web package filename')
}
await rename(resolve(distributionRoot, packedFilename), artifactPath)
await rm(stagingRoot, { recursive: true, force: true })

globalThis.console.log(`Created ${artifactPath}`)

function validateIdentity(channel, commit) {
  if (!['development', 'stable', 'nightly'].includes(channel)) {
    throw new Error(`Unsupported PICTOR_BUILD_CHANNEL: ${channel}`)
  }
  if (commit !== null && !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('PICTOR_SOURCE_COMMIT must be a full lowercase Git commit SHA')
  }
  if (channel !== 'development' && commit === null) {
    throw new Error('PICTOR_SOURCE_COMMIT is required for packaged build channels')
  }
}

function exactRuntimeDependencies(dependencies, lock) {
  const exact = {}
  for (const dependency of Object.keys(dependencies ?? {}).sort()) {
    const version = lock.packages?.[`node_modules/${dependency}`]?.version
    if (typeof version !== 'string') {
      throw new Error(`package-lock.json is missing runtime dependency ${dependency}`)
    }
    exact[dependency] = version
  }
  return exact
}

async function runNpm(arguments_, cwd) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(executable, arguments_, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`npm ${arguments_.join(' ')} exited with signal ${signal}`))
        return
      }
      resolvePromise(code ?? 1)
    })
  })
  if (exitCode !== 0) throw new Error(`npm ${arguments_.join(' ')} failed: ${exitCode}`)
  return stdout
}
