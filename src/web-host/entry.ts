import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveUserDataDirectory } from '../application/index.js'
import { createWebApplication } from './application.js'
import { WebSessionAuth } from './auth.js'
import { CreationModeWatcher } from './creation-mode.js'
import { WebFileTransferStore } from './file-transfers.js'
import { openExternalUrl } from './open-external.js'
import { parseWebArgs, WebUsageError } from './parser.js'
import { WebHostServer } from './server.js'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))

export async function main(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  let application: Awaited<ReturnType<typeof createWebApplication>> | null = null
  let server: WebHostServer | null = null
  let creationMode: CreationModeWatcher | null = null
  let stopping: Promise<void> | null = null

  try {
    const request = parseWebArgs(arguments_)
    const projectRoot = request.development
      ? resolve(sourceDirectory, '../..')
      : resolve(sourceDirectory, '../../../..')
    const userDataDirectory = resolveUserDataDirectory(request.userDataDirectory, {
      applicationName: webApplicationName(),
    })
    const runtimeHostPath = request.development
      ? resolve(projectRoot, 'src/runtime/host.ts')
      : resolve(sourceDirectory, '../runtime/host.js')
    application = await createWebApplication({
      projectRoot,
      userDataDirectory,
      runtimeHostPath,
      safeMode: request.safeMode,
      profile: request.profile,
      creationMode: request.development,
    })
    const auth = developmentAuth(request.development)
    server = new WebHostServer({
      services: application.services,
      moduleEvents: application.moduleEvents,
      staticDirectory: resolve(projectRoot, 'out/web/client'),
      fileTransfers: new WebFileTransferStore(resolve(userDataDirectory, 'web-transfers')),
      port: request.port,
      ...(auth ? { auth } : {}),
      ...(request.development
        ? { development: { rendererRoot: resolve(projectRoot, 'src/renderer') } }
        : {}),
    })
    const address = await server.start()
    const creationTrigger = process.env.PICTOR_WEB_CREATION_TRIGGER
    if (request.development && creationTrigger) {
      creationMode = new CreationModeWatcher({
        pluginStore: application.services.pluginStore,
        userDataDirectory,
        triggerPath: creationTrigger,
      })
      await creationMode.start()
    }

    const stop = (): Promise<void> => {
      if (stopping) return stopping
      stopping = (async () => {
        creationMode?.stop()
        await server?.stop()
        await application?.applicationHost.stop()
      })()
      return stopping
    }
    process.once('SIGINT', () => void stop().finally(() => process.exit(0)))
    process.once('SIGTERM', () => void stop().finally(() => process.exit(0)))

    console.log(`Pictor Web Host listening at ${address.origin}`)
    if (request.openBrowser) {
      await openExternalUrl(address.launchUrl).catch((error: unknown) => {
        console.warn('Unable to open the browser automatically', error)
        console.log(`Open this one-time URL: ${address.launchUrl}`)
      })
    } else {
      console.log(`Open this one-time URL: ${address.launchUrl}`)
    }
    return 0
  } catch (error) {
    creationMode?.stop()
    await server?.stop().catch(() => undefined)
    await application?.applicationHost.stop().catch(() => undefined)
    console.error(
      error instanceof WebUsageError ? error.message : 'Failed to start Pictor Web Host',
      error,
    )
    return error instanceof WebUsageError ? 2 : 1
  }
}

export function webApplicationName(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): 'pictor' | 'pictor-dev' {
  return environment.PICTOR_PACKAGED === '1' ? 'pictor' : 'pictor-dev'
}

function developmentAuth(development: boolean): WebSessionAuth | undefined {
  if (!development) return undefined
  const launchToken = process.env.PICTOR_WEB_LAUNCH_TOKEN
  const sessionToken = process.env.PICTOR_WEB_SESSION_TOKEN
  if (!launchToken && !sessionToken) return undefined
  if (!launchToken || !sessionToken) {
    throw new Error('Development Web Host requires both stable authentication tokens')
  }
  return new WebSessionAuth({ launchToken, sessionToken })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
