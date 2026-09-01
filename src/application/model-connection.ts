// The model connection adapter is frontend-neutral. Keep the historical Main
// export as a compatibility facade while Node frontends consume this public
// Application boundary.
export { ModelConnectionTester } from '../main/model-connection.js'
