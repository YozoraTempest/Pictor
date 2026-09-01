import { getCurrentFuseWire, FuseVersion, FuseV1Options } from '@electron/fuses'

export const ELECTRON_FUSE_CONFIGURATION = Object.freeze({
  runAsNode: true,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  grantFileProtocolExtraPrivileges: false,
})

const FUSE_STATE = Object.freeze({ disabled: 0x30, enabled: 0x31 })

const FUSE_OPTIONS = Object.freeze([
  ['runAsNode', FuseV1Options.RunAsNode],
  ['enableCookieEncryption', FuseV1Options.EnableCookieEncryption],
  ['enableNodeOptionsEnvironmentVariable', FuseV1Options.EnableNodeOptionsEnvironmentVariable],
  ['enableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments],
  ['enableEmbeddedAsarIntegrityValidation', FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
  ['onlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar],
  ['loadBrowserProcessSpecificV8Snapshot', FuseV1Options.LoadBrowserProcessSpecificV8Snapshot],
  ['grantFileProtocolExtraPrivileges', FuseV1Options.GrantFileProtocolExtraPrivileges],
])

export async function assertFuseWire(binaryPath, label = binaryPath) {
  const wire = await getCurrentFuseWire(binaryPath)
  if (wire.version !== FuseVersion.V1) {
    throw new Error(`${label} uses unsupported Electron fuse version ${wire.version}`)
  }

  const states = {}
  for (const [name, index] of FUSE_OPTIONS) {
    const actual = wire[index]
    const expected = ELECTRON_FUSE_CONFIGURATION[name] ? FUSE_STATE.enabled : FUSE_STATE.disabled
    if (actual !== expected) {
      throw new Error(
        `${label} fuse ${name} is ${formatFuseState(actual)}, expected ${formatFuseState(expected)}`,
      )
    }
    states[name] = actual === FUSE_STATE.enabled ? 'enabled' : 'disabled'
  }

  return { version: wire.version, states }
}

export function formatFuseState(state) {
  if (state === FUSE_STATE.enabled) return 'enabled'
  if (state === FUSE_STATE.disabled) return 'disabled'
  if (state === 0x72) return 'removed'
  if (state === 0x90) return 'inherited'
  return `unknown(0x${Number(state).toString(16)})`
}

export { FUSE_OPTIONS }
