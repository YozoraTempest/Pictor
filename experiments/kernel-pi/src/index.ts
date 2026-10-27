/**
 * Pi as a kernel package.
 *
 * The RPC driver, its event translation, the session-file reader, the isolated
 * configuration directory and the guard extension all live here. The app imports this
 * module by name and gets a factory for a cordis plugin, so the kernel can be shipped
 * with the app or installed from npm without a change of shape.
 */
export { createPiKernel } from './pi-kernel.js'
export { PI_OWN_CONFIG_KEY, PiRpcDriver } from './pi-rpc-driver.js'
