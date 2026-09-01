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

const developmentData = developmentUserDataPath(
  app.getPath('appData'),
  app.isPackaged,
  process.argv,
)
if (developmentData) app.setPath('userData', developmentData)

const desktopHost = new DesktopHost()

void app
  .whenReady()
  .then(() => desktopHost.start())
  .catch((error: unknown) => {
    console.error('Failed to start Desktop Host', error)
    app.quit()
  })

app.on('window-all-closed', () => app.quit())
