# Architecture constraints

This document only records the structure and dependency rules a contributor must
follow. Product direction and decision history live in the maintainer's Trilium
knowledge base.

## Principles

- `ApplicationHost` is the headless application core. It owns commands, events and
  the `MetadataStore` port. It must not import Electron, React, DOM or the
  renderer.
- The Rust `host-core` sidecar is the only writer of SQLite. Node code reaches it
  exclusively through `@pictor/host-client`; no other package opens the database.
- Protocols crossing a process or plugin boundary are serialisable. Plugins only
  receive the public `@pictor/plugin-sdk` surface.
- The renderer sees one narrow bridge. Electron capabilities stay in `main`, and
  the preload exposes no `ipcRenderer`, Node or filesystem object. Sandbox,
  context isolation and `nodeIntegration: false` are mandatory; the preload is
  emitted as CommonJS because sandboxed renderers do not load ESM preloads.

## Dependency direction

```text
Renderer -> bridge types -> preload -> IPC -> main -> application -> host-client -> racp -> stdio
main -> plugin-host -> plugin-sdk
main -> agent-runtime -> AgentRuntime
host-core (Rust) -> SQLite
```

Forbidden:

- `packages/shared` importing Node, Electron, React or any concrete package.
- `packages/plugin-sdk` importing `src/`, Electron, React or the Pi SDK.
- Renderer importing Electron, Node built-ins or main-process code.
- Any package opening the SQLite file directly.

## Boundaries

### Sidecar

`crates/host-core` speaks newline-delimited JSON-RPC 2.0 on stdin/stdout. stdout
carries frames only; diagnostics go to stderr. Method names are dotted
(`project.add`, `plugin.setEnabled`) and every error maps to a stable code.

### Application and plugins

`ApplicationHost` registers core commands and exposes `list()`/`execute()`.
Plugin commands are registered into the same engine after activation, so callers
do not distinguish their origin.

Plugin lifecycle: discovery -> manifest validation -> engine check -> dependency
resolution -> topological order -> activation -> reverse disposal. Failures are
isolated per plugin and surfaced in the plugin report.

### Chat

`@pictor/chat` owns the active agent session:

- One Pi session per process. `open()` disposes the previous agent, so switching
  Pictor sessions is explicit.
- The JSONL transcript is the only history source. `history.ts` projects it for
  display and paginates from the newest message backwards.
- `session.piSessionId` stores the transcript path; `session.bindPiSession`
  persists it through the Rust store.
- Events are normalised in the chat package and forwarded to the renderer over
  one IPC channel (`pictor:chat.event`).
- Tool approval is a seam, not a policy: `setToolInterceptor` installs a
  `beforeToolCall` hook that can block a call. The default is allow-all so an
  approval Plugin can own the decision.

### Model configuration

`@pictor/model-config` owns the settings contract:

- Non-secret values (`pi.*`) go through `MetadataStore` into SQLite.
- `auth.json` holds the key with `0600` permissions; only the main process reads
  it, and the bridge exposes `hasApiKey` instead of the value.
- `models.json` is generated for Pi with `apiKey: "$PICTOR_PROVIDER_API_KEY"`;
  `PiAgentRuntime` injects the variable only for the run and deletes it after.
- cc-switch access is read-only and implemented in Rust (`ccswitch.scan` /
  `ccswitch.read`); the scan response never contains a key.

### Storage

SQLite holds projects, sessions, plugin records and settings. Pi JSONL remains the
future source of truth for agent transcripts; `agent-runtime/projection.ts` only
projects it and never writes a second history.

## Adding code

- Headless feature: `packages/<feature>/src`, exported through its `index.ts`.
- Plugin: `plugins/<name>` with `manifest.json`, `src/`, and an esbuild bundle in
  `dist/`. The directory is optional; an empty install simply has no plugins.
- Panel contribution: `contributes('panels', { id, title, command })` adds one
  entry to the side panel. Panels are data only — opening one runs a command, so
  plugins never ship renderer code. `tools` is reserved for the agent-facing
  capability surface; an agent tool may open a panel, but a panel is not a tool.
- Tool guard: `contributes('toolGuards', { id, tools?, decide })` polices agent
  tool calls before they run. Guards are the only place that can deny a call;
  they run in contribution order, the first deny wins, and a guard that throws
  fails closed. Denials surface as a blocked row in the transcript instead of a
  silent abort.
- Tests sit next to the implementation as `*.test.ts`; cross-module behaviour is
  tested through the public seam (client, engine, plugin host).
