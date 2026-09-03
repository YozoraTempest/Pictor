import { PictorError } from '../shared/errors.js'
import type {
  RuntimeCompactConfig,
  RuntimeExportConfig,
  RuntimeForkConfig,
  RuntimeImportConfig,
  RuntimeLabelConfig,
  RuntimeNavigateConfig,
  RuntimeSessionOpenConfig,
  RuntimeStartConfig,
} from '../shared/runtime-protocol.js'
import type { RuntimeHost } from '../application/ports.js'

export const HEADLESS_RUNTIME_UNAVAILABLE_MESSAGE =
  'Agent Runtime 在 CLI Frontend 中不可用；请使用 GUI 或支持 Runtime 的 Frontend'

/** Runtime adapter used by the CLI. It never starts Electron or a utility process. */
export class HeadlessRuntimeHost implements RuntimeHost {
  async openSession(_config: RuntimeSessionOpenConfig): Promise<void> {
    throw unavailable()
  }

  async closeSession(): Promise<void> {
    throw unavailable()
  }

  async start(_config: RuntimeStartConfig): Promise<void> {
    throw unavailable()
  }

  async fork(_config: RuntimeForkConfig): Promise<never> {
    throw unavailable()
  }

  async importSession(_config: RuntimeImportConfig): Promise<never> {
    throw unavailable()
  }

  async exportSession(_config: RuntimeExportConfig): Promise<never> {
    throw unavailable()
  }

  async navigateSession(_config: RuntimeNavigateConfig): Promise<never> {
    throw unavailable()
  }

  async compactSession(_config: RuntimeCompactConfig): Promise<never> {
    throw unavailable()
  }

  async labelSessionEntry(_config: RuntimeLabelConfig): Promise<never> {
    throw unavailable()
  }

  abortSessionOperation(_operationId: string): void {
    throw unavailable()
  }

  async reloadResources(_sessionId: string): Promise<void> {
    throw unavailable()
  }

  stop(_runId: string): void {
    throw unavailable()
  }

  respondToExtensionUi(
    _sessionId: string,
    _requestId: string,
    _value: string | boolean | null,
  ): void {
    throw unavailable()
  }

  queueMessage(_runId: string, _mode: 'steer' | 'follow-up', _message: string): void {
    throw unavailable()
  }

  clearQueue(_runId: string): void {
    throw unavailable()
  }

  isActive(): boolean {
    return false
  }

  async dispose(): Promise<void> {
    // There is no child process to dispose. Shutdown remains a successful
    // no-op; every actual Runtime operation above is explicit about being
    // unavailable.
  }
}

function unavailable(): PictorError {
  return new PictorError('internal', HEADLESS_RUNTIME_UNAVAILABLE_MESSAGE)
}
