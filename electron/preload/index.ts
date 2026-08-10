import { contextBridge, ipcRenderer } from 'electron'

import { appInfoSchema, type PictorBridge } from '../../src/shared/contracts.js'

const bridge: PictorBridge = Object.freeze({
  getAppInfo: async () => appInfoSchema.parse(await ipcRenderer.invoke('app:get-info')),
})

contextBridge.exposeInMainWorld('pictor', bridge)
