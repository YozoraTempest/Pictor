/**
 * What a shell gets from the harness on the main process side.
 *
 * Everything here is reachable by subpath too (`./main/bridge`, `./main/kernel/dsh`); this
 * entry exists so the common ones have one name, and so `exports` never points at a file
 * that is not there.
 */
export * from './bridge.js'
export { DshHarness } from './kernel/dsh.js'
export { provideKernel, startEngine, type EngineHost } from './kernel/host.js'
