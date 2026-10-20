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

### Storage

SQLite holds projects, sessions, plugin records and settings. Pi JSONL remains the
future source of truth for agent transcripts; `agent-runtime/projection.ts` only
projects it and never writes a second history.

## Adding code

- Headless feature: `packages/<feature>/src`, exported through its `index.ts`.
- Bundled plugin: `plugins/<name>` with `manifest.json`, `src/`, and an esbuild
  bundle in `dist/`.
- Tests sit next to the implementation as `*.test.ts`; cross-module behaviour is
  tested through the public seam (client, engine, plugin host).
