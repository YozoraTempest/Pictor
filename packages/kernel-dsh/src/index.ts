/**
 * dsh as a kernel package.
 *
 * Everything the DeepSeek Harness kernel needs lives here: its driver, its profile
 * patch, its history reader, its question translation and the guard plugin it inserts.
 * The app imports this module the way any installed kernel is imported — by name —
 * and gets a cordis plugin back, so "ship it inside the app" and "install it from npm"
 * are the same package with two delivery routes.
 */
export { dshKernel } from './dsh-kernel.js'
export { DshDriver } from './dsh-driver.js'
export {
  jobOf,
  planActiveOf,
  sessionStates,
  subagentOf,
  todosOf,
  type SessionStates,
} from './harness-session-state.js'
