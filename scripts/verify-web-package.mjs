import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const artifactPath = resolve(repositoryRoot, 'dist', `Pictor-${packageMetadata.version}-web.tgz`)
const expectedChannel = process.env.PICTOR_BUILD_CHANNEL ?? 'development'
const expectedCommit = process.env.PICTOR_SOURCE_COMMIT ?? null
const testRoot = await mkdtemp(join(tmpdir(), 'pictor-web-package-'))
const installRoot = resolve(testRoot, 'installation')
const profileRoot = resolve(testRoot, 'profile')

try {
  const artifact = await stat(artifactPath)
  if (!artifact.isFile() || artifact.size === 0) {
    throw new Error(`Expected a non-empty Web package: ${artifactPath}`)
  }

  await runNpm(
    [
      'install',
      '--global',
      '--prefix',
      installRoot,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      artifactPath,
    ],
    testRoot,
  )

  const installedRoot = resolve(
    installRoot,
    process.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
    '@yozoratempest/pictor-web',
  )
  const launcherPath = resolve(installedRoot, 'bin/pictor-web.mjs')
  const binPath = resolve(
    installRoot,
    process.platform === 'win32' ? 'pictor-web.cmd' : 'bin/pictor-web',
  )
  await access(resolve(installedRoot, 'LICENSE'))
  await access(launcherPath)
  await access(binPath)

  const installedPackage = JSON.parse(
    await readFile(resolve(installedRoot, 'package.json'), 'utf8'),
  )
  if (installedPackage.dependencies?.electron || installedPackage.devDependencies?.electron) {
    throw new Error('Web package must not depend on Electron')
  }
  const identity = JSON.parse(
    await readFile(resolve(installedRoot, 'out/package-identity.json'), 'utf8'),
  )
  const expectedIdentity = {
    version: packageMetadata.version,
    buildChannel: expectedChannel,
    sourceCommit: expectedCommit,
  }
  if (JSON.stringify(identity) !== JSON.stringify(expectedIdentity)) {
    throw new Error(
      `Web package identity mismatch: ${JSON.stringify(identity)} != ${JSON.stringify(expectedIdentity)}`,
    )
  }

  const smoke = await startWebHost(binPath, profileRoot)
  try {
    const launchResponse = await globalThis.fetch(smoke.launchUrl, { redirect: 'manual' })
    if (launchResponse.status !== 303) {
      throw new Error(`Web package launch token exchange returned ${launchResponse.status}`)
    }
    const cookie = launchResponse.headers.get('set-cookie')?.split(';', 1)[0]
    if (!cookie) throw new Error('Web package did not issue a session cookie')

    const pageResponse = await globalThis.fetch(smoke.origin, {
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
    })
    const page = await pageResponse.text()
    if (!pageResponse.ok || !page.includes('<div id="root"></div>')) {
      throw new Error(`Web package root page failed: ${pageResponse.status}`)
    }

    const appInfoResponse = await globalThis.fetch(`${smoke.origin}/api/v1/app-info`, {
      headers: {
        cookie,
        origin: smoke.origin,
        'sec-fetch-site': 'same-origin',
      },
    })
    const appInfo = await appInfoResponse.json()
    if (
      !appInfoResponse.ok ||
      appInfo?.value?.version !== expectedIdentity.version ||
      appInfo?.value?.buildChannel !== expectedIdentity.buildChannel ||
      appInfo?.value?.sourceCommit !== expectedIdentity.sourceCommit
    ) {
      throw new Error(`Web package app-info mismatch: ${JSON.stringify(appInfo)}`)
    }
  } finally {
    await smoke.stop()
  }

  globalThis.console.log(
    JSON.stringify(
      {
        artifact: artifactPath,
        bytes: artifact.size,
        identity,
        electronDependency: false,
        globalInstall: true,
        installedLauncher: true,
        browserSmoke: true,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(testRoot, { recursive: true, force: true })
}

async function startWebHost(binPath, profileDirectory) {
  const child = spawn(binPath, ['--no-open', '--port', '0', '--user-data-dir', profileDirectory], {
    cwd: dirname(binPath),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let output = ''
  const address = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for packaged Web Host:\n${output}`))
    }, 30_000)
    const inspect = (chunk) => {
      output += chunk
      const origin = output.match(/Pictor Web Host listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      const launchUrl = output.match(
        /Open this one-time URL: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/,
      )?.[1]
      if (!origin || !launchUrl) return
      clearTimeout(timeout)
      resolvePromise({ origin, launchUrl })
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(
        new Error(`Packaged Web Host exited before readiness (${signal ?? code ?? 1}):\n${output}`),
      )
    })
  })

  try {
    const resolved = await address
    return {
      ...resolved,
      stop: async () => {
        if (child.exitCode !== null || child.signalCode !== null) return
        child.kill('SIGTERM')
        await Promise.race([
          new Promise((resolvePromise) => child.once('exit', resolvePromise)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Packaged Web Host did not stop')), 10_000),
          ),
        ])
      },
    }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    throw error
  }
}

async function runNpm(arguments_, cwd) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(executable, arguments_, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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
}
