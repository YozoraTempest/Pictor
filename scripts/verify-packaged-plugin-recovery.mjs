import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { BUNDLED_PLUGIN_IDS } from './distribution-contract.mjs'
import { launchPackagedGui } from './packaged-gui.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const testRoot = await mkdtemp(resolve(tmpdir(), 'pictor-packaged-recovery-'))
const profile = join(testRoot, 'profile with spaces')
const projectPath = join(testRoot, 'project with spaces')
const commandCwd = join(testRoot, 'command cwd')
await mkdir(profile, { recursive: true })
await mkdir(projectPath, { recursive: true })
await mkdir(commandCwd, { recursive: true })

const isWindows = process.platform === 'win32'
const guiExecutable = resolve(
  process.env.PICTOR_GUI_EXECUTABLE ??
    (isWindows
      ? resolve(repositoryRoot, 'dist', 'win-unpacked', 'Pictor.exe')
      : resolve(repositoryRoot, 'dist', 'linux-unpacked', 'pictor')),
)
const launcher = resolve(
  process.env.PICTOR_FRONTEND_LAUNCHER ??
    (isWindows
      ? resolve(repositoryRoot, 'dist', 'win-unpacked', 'bin', 'pictor.cmd')
      : guiExecutable),
)

let application = null
try {
  application = await launchGui()
  let window = await application.firstWindow()
  await window.waitForSelector('.app-shell', { timeout: 30_000 })
  const dataBefore = await registerProjectAndSession(window)
  await application.close()
  application = null

  const remove = await runFrontend([
    'cli',
    '--user-data-dir',
    profile,
    'plugin',
    'remove',
    '--kind',
    'pictor-plugin',
    '--id',
    'pictor.workbench.delegate',
  ])
  assertCommand(remove, 'packaged CLI Workbench removal', 'desired=removed')

  const removedList = await runFrontend(['cli', '--user-data-dir', profile, 'plugin', 'list'])
  assertCommand(removedList, 'packaged CLI removed-state inspection', 'pictor.workbench.delegate')
  assertCommand(removedList, 'packaged CLI removed-state inspection', 'desired=removed')

  application = await launchGui()
  window = await application.firstWindow()
  await window.waitForSelector('.pictor-shell', { timeout: 30_000 })
  const shellText = await window.locator('body').innerText()
  for (const id of BUNDLED_PLUGIN_IDS) {
    if (!shellText.includes(id))
      throw new Error(`Pictor Shell did not expose recovery source ${id}`)
  }
  const dataDuringShell = await readWorkspaceSnapshot(window)
  assertWorkspaceData(dataDuringShell, dataBefore)
  const workbenchRow = window
    .locator('.pictor-shell__plugin-row')
    .filter({ hasText: 'pictor.workbench.delegate' })
  await workbenchRow.getByRole('button', { name: '恢复' }).click()
  await window.getByText('操作已记录；重启 Pictor 后生效。').waitFor()
  await application.close()
  application = null

  application = await launchGui()
  window = await application.firstWindow()
  await window.waitForSelector('.app-shell', { timeout: 30_000 })
  if ((await window.locator('.pictor-shell').count()) !== 0) {
    throw new Error('Restored packaged GUI did not return from Pictor Shell to Delegate Workbench')
  }
  await window.locator('.workspace').waitFor({ state: 'visible', timeout: 30_000 })
  const dataAfter = await readWorkspaceSnapshot(window)
  assertWorkspaceData(dataAfter, dataBefore)

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        profile,
        removed: 'pictor.workbench.delegate',
        recoverySources: BUNDLED_PLUGIN_IDS.length,
        state: {
          cliRemoveExitCode: remove.exitCode,
          cliListExitCode: removedList.exitCode,
          shell: 'Pictor Shell',
          restored: 'Delegate Workbench',
        },
        preserved: {
          projectId: dataBefore.projectId,
          sessionId: dataBefore.sessionId,
        },
      },
      null,
      2,
    )}\n`,
  )
} finally {
  if (application) await application.close().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
}

async function launchGui() {
  return launchPackagedGui(
    guiExecutable,
    [`--user-data-dir=${profile}`],
    isWindows ? {} : { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  )
}

async function registerProjectAndSession(window) {
  const result = await window.evaluate(
    async ({ projectPath }) => {
      const transport = globalThis.pictorModules
      const project = await transport.invoke('pictor.agent-workspace', 'registerProject', {
        rootPath: projectPath,
        trusted: true,
      })
      if (!project.ok) throw new Error(project.error.message)
      const session = await transport.invoke('pictor.agent-workspace', 'createSession', {
        projectId: project.value.id,
      })
      if (!session.ok) throw new Error(session.error.message)
      return { projectId: project.value.id, sessionId: session.value.id }
    },
    { projectPath },
  )
  return result
}

async function readWorkspaceSnapshot(window) {
  const result = await window.evaluate(() =>
    globalThis.pictorModules.invoke('pictor.agent-workspace', 'getSnapshot', null),
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function assertWorkspaceData(snapshot, expected) {
  if (
    !snapshot.projects.some(({ id }) => id === expected.projectId) ||
    !snapshot.sessions.some(({ id }) => id === expected.sessionId)
  ) {
    throw new Error(`Packaged recovery changed workspace data: ${JSON.stringify(snapshot)}`)
  }
}

function runFrontend(arguments_) {
  const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : launcher
  const commandArguments = isWindows
    ? ['/d', '/s', '/c', `${quoteForCmd(launcher)} ${arguments_.map(quoteForCmd).join(' ')}`]
    : arguments_
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArguments, {
      cwd: commandCwd,
      env: {
        ...process.env,
        ...(launcher.toLowerCase().endsWith('.appimage') ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => resolvePromise({ exitCode, signal, stdout, stderr }))
  })
}

function quoteForCmd(argument) {
  return `"${String(argument).replaceAll('"', '\\"')}"`
}

function assertCommand(result, label, expectedOutput) {
  if (result.exitCode !== 0 || !result.stdout.includes(expectedOutput)) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  }
}
