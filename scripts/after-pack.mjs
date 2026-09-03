import { access, chmod, copyFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POSIX_LAUNCHER = resolve(repositoryRoot, 'packaging', 'posix', 'pictor')

export default async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    await access(join(context.appOutDir, 'bin', 'pictor.cmd'))
    return
  }
  if (context.electronPlatformName !== 'linux') return

  const electronBinary = join(context.appOutDir, 'pictor')
  const guiBinary = join(context.appOutDir, 'pictor-gui')
  const launcher = join(context.appOutDir, 'pictor')
  const addElectronFuses = context.packager.addElectronFuses.bind(context.packager)
  let finalized = false

  // electron-builder 26 invokes the user afterPack hook immediately before its
  // built-in fuse operation. Keep the real Electron binary at the canonical
  // path until that operation has completed, then install the shared POSIX
  // launcher that AppRun and the Pacman symlink both enter.
  context.packager.addElectronFuses = async (fuseContext, fuseConfig) => {
    if (finalized) return 0
    const sentinelCount = await addElectronFuses(fuseContext, fuseConfig)
    await rename(electronBinary, guiBinary)
    await copyFile(POSIX_LAUNCHER, launcher)
    await chmod(launcher, 0o755)
    finalized = true
    return sentinelCount
  }
}
