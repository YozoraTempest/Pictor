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

export function isTrustedRendererUrl(url: string, developmentUrl?: string): boolean {
  const parsedUrl = new URL(url)

  if (developmentUrl) {
    return parsedUrl.origin === new URL(developmentUrl).origin
  }

  return parsedUrl.protocol === 'app:' && parsedUrl.host === 'bundle'
}
