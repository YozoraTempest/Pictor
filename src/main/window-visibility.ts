export function shouldShowMainWindow(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.PICTOR_E2E_HEADLESS !== '1'
}

export function shouldShowMainWindowWithoutFocus(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.PICTOR_E2E_NO_FOCUS === '1'
}
