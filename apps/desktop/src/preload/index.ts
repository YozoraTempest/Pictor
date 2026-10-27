import { contextBridge, ipcRenderer } from 'electron'

import { installHarnessBridge } from './harness.js'

// The shell's whole preload: hand the harness one channel and let it build its own
// surface. Nothing here names a conversation, a model or a setting.
contextBridge.exposeInMainWorld('pictor', installHarnessBridge(ipcRenderer))
