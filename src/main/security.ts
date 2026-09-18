import type { WebPreferences } from 'electron'

export function getSecureWebPreferences(): Pick<
  WebPreferences,
  'contextIsolation' | 'nodeIntegration' | 'sandbox' | 'webSecurity'
> {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  }
}

export function isTrustedRendererUrl(url: string, trustedOrigin: string): boolean {
  try {
    return new URL(url).origin === trustedOrigin
  } catch {
    return false
  }
}
