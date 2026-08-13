export function shouldShowMainWindow(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.PICTOR_E2E_HEADLESS !== '1'
}
