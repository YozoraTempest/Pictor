import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

import { chromium } from 'playwright-core'

/**
 * Where the runtime binary may already be.
 *
 * Chat needs the DeepSeek runtime, which one profile installs with npm. A spec
 * must not trigger that install, so it looks for one that exists: the project
 * documents `PICTOR_DSH_BIN` for a pinned checkout, and a developer who has run
 * the app has one in their own profile.
 */
function runtimeBinary() {
  const explicit = process.env['PICTOR_DSH_BIN']
  if (explicit !== undefined && existsSync(explicit)) return explicit

  const candidates = [
    join(homedir(), '.config/pictor'),
    join(homedir(), '.local/share/pictor'),
    join(homedir(), 'Library/Application Support/pictor'),
  ]
  for (const root of candidates) {
    const binary = join(root, 'harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js')
    if (existsSync(binary)) return binary
  }
  return null
}
/**
 * Drives the real application.
 *
 * The app is launched the way a user launches it, with its own profile directory,
 * and the test talks to the renderer through Electron's own Chromium over CDP.
 * Nothing here stubs the bridge: a spec that passes has exercised main, the host
 * core and the renderer together.
 */

const APP_ROOT = resolve(import.meta.dirname, '..', 'apps', 'desktop')

/** A port the OS picked and released, so parallel runs cannot collide. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    // Port 0 asks the OS; reading it back and closing keeps the window tiny.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

/**
 * @typedef {object} App
 * @property {import('playwright-core').Page} page
 * @property {string} workdir an existing empty directory a spec may use as a project
 * @property {string | null} dsh the runtime binary the app will boot, if any
 * @property {() => Promise<void>} close
 */

/** @returns {Promise<App>} */
export async function launch() {
  const port = await freePort()
  // A throwaway profile: the spec must never read or write the user's own.
  const profile = mkdtempSync(join(tmpdir(), 'pictor-e2e-'))
  // Projects must point at a real directory, so the run owns one of those too.
  const workdir = mkdtempSync(join(tmpdir(), 'pictor-e2e-work-'))
  // Handing the app a runtime it did not install is what keeps this suite off the
  // network: the profile is empty, so the app would otherwise install one.
  const dsh = runtimeBinary()

  // CI runs headless, where Chromium's sandbox may be unavailable; a spec host can
  // pass extra switches without teaching this file about any particular runner.
  const extraArgs = (process.env['PICTOR_E2E_ELECTRON_ARGS'] ?? '').split(' ').filter(Boolean)

  const child = spawn(
    process.execPath,
    [
      join(APP_ROOT, '..', '..', 'node_modules', 'electron', 'cli.js'),
      '.',
      `--remote-debugging-port=${String(port)}`,
      ...extraArgs,
    ],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        PICTOR_USER_DATA: profile,
        ELECTRON_ENABLE_LOGGING: '0',
        ...(dsh === null ? {} : { PICTOR_DSH_BIN: dsh }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const logs = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => logs.push(chunk))
  child.stderr?.on('data', (chunk) => logs.push(chunk))

  /** Poll the CDP endpoint until the window is up. */
  const deadline = Date.now() + 60_000
  let browser = null
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
    if (child.exitCode !== null) break
  }

  if (browser === null) {
    child.kill('SIGKILL')
    throw new Error(`e2e: the app never exposed CDP\n${logs.join('').slice(-2000)}`)
  }

  const context = browser.contexts()[0]
  const page = context?.pages()[0]
  if (page === undefined) {
    await browser.close()
    child.kill('SIGKILL')
    throw new Error('e2e: no window to drive')
  }

  // The window renders before the host core has answered; every spec starts from
  // a settled ui rather than racing the first paint.
  await page.waitForSelector('[role=log], header', { timeout: 30_000 })

  return {
    page,
    workdir,
    dsh,
    close: async () => {
      // The runtime is a child of the app, and killing the window would leave it
      // running for the next spec — and every later run — to trip over.
      await page.evaluate(() => window.pictor.harnessStop()).catch(() => undefined)
      // Stopping asks the runtime to leave and gives it three seconds before the
      // kill; killing the window first would leave that child behind.
      await new Promise((r) => setTimeout(r, 3_500))
      await browser.close().catch(() => undefined)
      child.kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 300))
      rmSync(profile, { recursive: true, force: true })
      rmSync(workdir, { recursive: true, force: true })
    },
  }
}
