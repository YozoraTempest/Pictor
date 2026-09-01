import { app, protocol } from 'electron'

import { DesktopHost } from './desktop-host.js'
import { developmentUserDataPath } from './development-profile.js'

const APP_SCHEME = 'app'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

app.enableSandbox()
startupDiagnostic('main entry')

const developmentData = developmentUserDataPath(
  app.getPath('appData'),
  app.isPackaged,
  process.argv,
)
if (developmentData) app.setPath('userData', developmentData)

if (isRejectedPackagedNodeEntry()) {
  console.error(
    'Packaged Pictor CLI/TUI entry requires the runAsNode fuse; refusing to start the GUI process',
  )
  app.exit(1)
} else {
  const desktopHost = new DesktopHost()

  void app
    .whenReady()
    .then(() => {
      startupDiagnostic('Electron ready')
      return desktopHost.start()
    })
    .catch((error: unknown) => {
      console.error('Failed to start Desktop Host', error)
      app.quit()
    })

  app.on('window-all-closed', () => app.quit())
}

function startupDiagnostic(message: string): void {
  if (process.env.PICTOR_STARTUP_DIAGNOSTICS === '1') console.error(`[pictor startup] ${message}`)
}

function isRejectedPackagedNodeEntry(): boolean {
  if (process.env.PICTOR_PACKAGED !== '1' || process.env.ELECTRON_RUN_AS_NODE !== '1') {
    return false
  }
  return process.argv.some((argument) =>
    /out[\\/]((?:cli[\\/]src[\\/]cli)|(?:tui[\\/]src[\\/]tui))[\\/]entry\.js/.test(argument),
  )
}
