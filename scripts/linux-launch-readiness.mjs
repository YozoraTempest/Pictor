export async function collectLaunchEvidence(window) {
  await window.waitForLoadState('domcontentloaded')
  await window.waitForFunction(
    () =>
      globalThis.document.querySelector('.app-shell') !== null ||
      globalThis.document.querySelector('.fatal-state') !== null,
    undefined,
    { timeout: 15_000 },
  )

  const renderer = await window.evaluate(() => {
    const readText = (element) => (element?.innerText ?? element?.textContent ?? '').trim()
    const shellElement = globalThis.document.querySelector('.app-shell')
    const fatalElement = globalThis.document.querySelector('.fatal-state')
    const shell = shellElement?.getBoundingClientRect()
    return {
      terminalState: fatalElement ? 'fatal' : shellElement ? 'ready' : 'unknown',
      title: globalThis.document.title,
      bodyTextLength: readText(globalThis.document.body).length,
      fatalText: fatalElement ? readText(fatalElement).slice(0, 2_000) : null,
      shell: shell ? { width: shell.width, height: shell.height } : null,
    }
  })

  if (renderer.terminalState === 'fatal') {
    throw new Error(`Packaged renderer entered fatal state: ${renderer.fatalText}`)
  }
  if (renderer.terminalState !== 'ready') {
    throw new Error(
      `Packaged renderer terminal state changed unexpectedly: ${renderer.terminalState}`,
    )
  }

  const appInfo = await window.evaluate(async () => globalThis.pictor.getAppInfo())
  return { ...renderer, appInfo }
}
