# Testing and CI

## Environment

```bash
pnpm install
cargo --version
```

Node and pnpm versions come from `.nvmrc` and `package.json`. The Electron runtime
is only needed for `pnpm dev` and packaging; install it with `pnpm deps:prepare`.

## Commands

| Purpose                        | Command                                            |
| ------------------------------ | -------------------------------------------------- |
| Format, types, lint, all tests | `pnpm verify`                                      |
| JS/TS tests                    | `pnpm test:js`                                     |
| Rust tests                     | `pnpm test:rust`                                   |
| Type check only                | `pnpm typecheck`                                   |
| Lint only                      | `pnpm lint`                                        |
| Format check                   | `pnpm format:check`                                |
| Production build               | `pnpm build`                                       |
| Run one file                   | `pnpm vitest run packages/racp/src/client.test.ts` |

## Test domains

- **Core**: `packages/*/src/**/*.test.ts` covering RACP framing, the host client,
  the command engine, profile locking, plugin resolution/lifecycle and the agent
  runtime projection.
- **Rust**: `cargo test -p pictor-host-core` covering migrations, store operations
  and JSON-RPC dispatch.
- **Renderer**: no test runner yet; the UI is verified through `pnpm build`.

Tests must use temporary directories and must never touch the real user profile or
a network endpoint. The Pi adapter is tested through pure mapping functions
(`toPiModel`, `mapPiEvent`) so no API key or live model is required.

## Desktop smoke test

`pnpm build` then run the packaged main process without showing a window:

```bash
cd apps/desktop
PICTOR_SMOKE=1 PICTOR_USER_DATA="$(mktemp -d)" ../../node_modules/.bin/electron .
```

The process starts host-core, activates bundled plugins, waits for the renderer's
`ready-to-show`, prints `[smoke] window ready` and exits. `PICTOR_USER_DATA`
keeps the real profile untouched, and `PICTOR_HOST_CORE` can point at a specific
sidecar binary.

## Live endpoint checks

Both checks are skipped by default and read every value from the environment, so
no endpoint or key is committed:

```bash
PICTOR_LIVE_TEST=1 \
PICTOR_LIVE_BASE_URL=https://api.example.com/v1 \
PICTOR_LIVE_MODEL=<model-id> \
PICTOR_LIVE_API_KEY=<key> \
pnpm vitest run packages/model-config/src/live.test.ts

PICTOR_LIVE_AGENT=1 \
PICTOR_LIVE_BASE_URL=https://api.example.com/v1 \
PICTOR_LIVE_MODEL=<model-id> \
PICTOR_LIVE_API_KEY=<key> \
pnpm vitest run packages/agent-runtime/src/live.test.ts
```

The first validates `/models` plus one completion; the second drives the real Pi
SDK adapter with tools disabled.

## CI

`.github/workflows/ci.yml` runs on Node 22.22.2 and stable Rust:

```text
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```
