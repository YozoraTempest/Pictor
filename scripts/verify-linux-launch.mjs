import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const executablePath = resolve(
  process.env.PICTOR_LINUX_EXECUTABLE ??
    resolve(repositoryRoot, 'dist', 'linux-unpacked', 'pictor'),
)
const expectedDistribution = process.env.PICTOR_EXPECTED_DISTRIBUTION
if (expectedDistribution && !['ubuntu', 'arch'].includes(expectedDistribution)) {
  throw new Error(`Unsupported expected distribution: ${expectedDistribution}`)
}

const explicitUserData = process.env.PICTOR_USER_DATA_DIR
const userDataDirectory = explicitUserData
  ? resolve(explicitUserData)
  : await mkdtemp(resolve(tmpdir(), 'pictor-packaged-launch-'))
await mkdir(userDataDirectory, { recursive: true })

const electronApp = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${userDataDirectory}`],
})

try {
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  const evidence = await window.evaluate(async () => {
    const appInfo = await globalThis.pictor.getAppInfo()
    const shell = globalThis.document.querySelector('.app-shell')?.getBoundingClientRect()
    return {
      appInfo,
      title: globalThis.document.title,
      bodyTextLength: globalThis.document.body.innerText.trim().length,
      shell: shell ? { width: shell.width, height: shell.height } : null,
    }
  })

  const appInfo = evidence.appInfo
  if (appInfo.platform !== 'linux' || appInfo.arch !== 'x64') {
    throw new Error(`Expected Linux x64, received ${appInfo.platform} ${appInfo.arch}`)
  }
  if (appInfo.version !== packageMetadata.version) {
    throw new Error(`Expected version ${packageMetadata.version}, received ${appInfo.version}`)
  }
  if (expectedDistribution && appInfo.distribution !== expectedDistribution) {
    throw new Error(
      `Expected ${expectedDistribution} distribution, received ${appInfo.distribution}`,
    )
  }
  if (appInfo.commandInterpreter.kind !== 'bash' || !appInfo.commandInterpreter.available) {
    throw new Error('Expected Bash to be available on the supported Linux acceptance baseline')
  }
  if (
    evidence.title !== 'Pictor' ||
    evidence.bodyTextLength === 0 ||
    !evidence.shell ||
    evidence.shell.width <= 0 ||
    evidence.shell.height <= 0
  ) {
    throw new Error(`Packaged renderer did not mount: ${JSON.stringify(evidence)}`)
  }
  if (process.env.PICTOR_SCREENSHOT_PATH) {
    await window.screenshot({ path: resolve(process.env.PICTOR_SCREENSHOT_PATH) })
  }

  stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        executablePath,
        userDataDirectory,
        appInfo,
        renderer: {
          title: evidence.title,
          bodyTextLength: evidence.bodyTextLength,
          shell: evidence.shell,
        },
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await electronApp.close()
  if (!explicitUserData) await rm(userDataDirectory, { recursive: true, force: true })
}
