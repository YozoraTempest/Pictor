import { runStandalone } from './harness/standalone.js'

// The shell: a window and a process. Everything behind it — sessions, models, the engine —
// is the harness, which is why this file imports one function and nothing else.
runStandalone()
