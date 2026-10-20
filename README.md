# Pictor

Pictor is an agent-native local development environment. This repository is the
new implementation: an Electron shell, a Rust host core that owns SQLite, and a
TypeScript application core shared by every frontend.

> Status: runnable scaffold. The engine, storage, plugin host and UI shell work;
> the agent runtime ships with a deterministic `echo` provider and a thin Pi SDK
> adapter that has not yet been exercised against a live endpoint.

## Requirements

- Node.js `22.22.2` or newer (see `.nvmrc`)
- pnpm `10` or newer
- Rust `1.80` or newer with Cargo

## Quick start

```bash
pnpm install
pnpm deps:prepare     # downloads the Electron runtime (once)
pnpm dev              # builds host-core (debug), then starts Electron
```

`pnpm dev` uses the normal per-user profile. `pnpm build` produces the JS bundles
and the release host-core binary.

## Verification

```bash
pnpm verify           # format + typecheck + lint + JS tests + Rust tests
pnpm test:js
pnpm test:rust
pnpm build
```

`pnpm verify` is the gate used by CI.

> Network note: if `crates.io` is unreachable in your environment, point Cargo at
> a mirror for the session, for example:
> `cargo --config 'source.crates-io.replace-with="mirror"' --config 'source.mirror.registry="sparse+https://rsproxy.cn/index/"' test -p pictor-host-core`

## Layout

```text
apps/desktop/          Electron main, preload and React renderer
crates/host-core/      Rust sidecar: SQLite schema, migrations, NDJSON JSON-RPC
packages/shared/       Serializable domain model and error codes
packages/racp/         NDJSON JSON-RPC framing, client and stdio transport
packages/host-client/  Typed client for the host core
packages/application/  ApplicationHost, Command Engine, Profile lock, events
packages/plugin-sdk/   Manifest, Module and Contribution contract
packages/plugin-host/  Discovery, SemVer resolution, lifecycle, installer
packages/agent-runtime/AgentRuntime contract, Pi adapter, JSONL projection
plugins/hello-workbench/Bundled reference plugin
```

## How it fits together

- `ApplicationHost` is frontend-agnostic. It owns commands and events, and calls
  the `MetadataStore` interface.
- The Rust sidecar is the only owner of SQLite. Electron talks to it over
  newline-delimited JSON-RPC on stdio; `packages/racp` keeps the transport
  swappable for a future WebSocket host.
- Plugins are discovered from `plugins/*`, validated against the SDK manifest,
  resolved with SemVer, activated in dependency order and disposed in reverse.
  A plugin that fails to activate is reported and does not block the others.
- The renderer only sees the narrow `window.pictor` bridge; no Node or Electron
  object crosses the context bridge, and the window runs with sandbox, context isolation, no Node
  integration and a restrictive CSP.

## Current scope

Implemented: profile locking, project/session metadata, plugin lifecycle,
command dispatch, minimal shell UI, deterministic agent runtime.

Not yet implemented: model settings UI, live Pi runs, session tree/navigation,
remote hosts, packaging/auto-update, end-to-end tests. Plugin modules run
in-process; there is no per-plugin process sandbox yet.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
