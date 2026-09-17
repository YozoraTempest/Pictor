import {
  appInfoResultSchema,
  pluginBootstrapResultSchema,
  voidResultSchema,
  type PictorBridge,
} from '../shared/desktop-bridge.js'
import { PictorError } from '../shared/errors.js'
import { WEB_API_PREFIX } from '../shared/web-protocol.js'
import { WebEventConnection } from './connection.js'
import { WebFilePicker } from './file-picker.js'
import { createWebTransports } from './transport.js'

export interface WebFrontendAdapters {
  readonly bridge: PictorBridge
  readonly modules: ReturnType<typeof createWebTransports>['modules']
  stop(): void
}

export async function createWebFrontendAdapters(): Promise<WebFrontendAdapters> {
  const connection = new WebEventConnection()
  const filePicker = new WebFilePicker()
  const transports = createWebTransports(connection, {
    onModuleInvocationSettled: (moduleId, method, input, outcome) =>
      filePicker.onModuleInvocationSettled(moduleId, method, input, outcome),
  })
  await connection.start()

  const bridge: PictorBridge = Object.freeze({
    commands: transports.commands,
    notifyGuiReady: async () =>
      voidResultSchema.parse(await postJson(`${WEB_API_PREFIX}/gui-ready`, null)),
    getAppInfo: async () => appInfoResultSchema.parse(await getJson(`${WEB_API_PREFIX}/app-info`)),
    getPluginBootstrap: async () =>
      pluginBootstrapResultSchema.parse(await getJson(`${WEB_API_PREFIX}/plugin-bootstrap`)),
    pickPlugin: (source: Parameters<PictorBridge['pickPlugin']>[0]) =>
      filePicker.pickPlugin(source),
    pickProjectDirectory: () => filePicker.pickProjectDirectory(),
    pickSessionImport: () => filePicker.pickSessionImport(),
    pickSessionExport: (request: Parameters<PictorBridge['pickSessionExport']>[0]) =>
      filePicker.pickSessionExport(request),
    pickMessageImages: () => filePicker.pickMessageImages(),
  })

  return {
    bridge,
    modules: transports.modules,
    stop: () => {
      transports.dispose()
      filePicker.stop()
      connection.stop()
    },
  }
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok)
    throw new PictorError('internal', `Web Host request failed: HTTP ${response.status}`)
  return response.json()
}

async function postJson(path: string, input: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok)
    throw new PictorError('internal', `Web Host request failed: HTTP ${response.status}`)
  return response.json()
}
