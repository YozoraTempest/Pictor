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
  the command engine, profile locking, plugin resolution/lifecycle, the wire
  protocol of `@pictor/harness` (fake socket) and the agent runtime projection.
- **Main process**: `apps/desktop/src/main/*.test.ts` covering the runtime event
  bridge, the history projection and the profile patch generator.
- **Rust**: `cargo test -p pictor-host-core` covering migrations, store operations
  and JSON-RPC dispatch.
- **Renderer**: `apps/desktop/src/renderer/src/**/*.test.tsx` under jsdom (stores,
  presenters, registries, settings schema); interactive behaviour is still
  verified by hand.

Tests must use temporary directories and must never touch the real user profile or
a network endpoint. The harness transport is exercised through an injected fake
socket, and the Pi adapter through pure mapping functions (`toPiModel`,
`mapPiEvent`), so no API key or live model is required.

## End-to-end specs

```bash
pnpm build          # the specs drive the built app, not the sources
pnpm test:e2e       # every spec
pnpm test:e2e search  # one spec, matched by file name
```

Each spec runs against a real window: the harness launches Electron with a
throwaway `PICTOR_USER_DATA` and a scratch project directory, connects over CDP
with `playwright-core` (no browser download — it uses Electron's own Chromium),
and hands the spec a `page`. A failing spec writes a screenshot to
`$PI_SCRATCH_DIR`.

Specs need a display. On a headless machine run them under `xvfb-run`, and note
that they are not part of `pnpm verify` — they are slower and they exercise the
real runtime, so they belong in a job of their own rather than in the gate every
commit waits on.

## Packaging

```bash
pnpm pack:dir    # unpacked app under dist/<platform>-unpacked
pnpm pack:dist   # installer under dist/
```

Both run `pnpm build` first, so the sidecar and the bundles are current. The
packager needs two things it cannot infer: the Rust binary is not an npm package
(it ships as `resources/host-core/pictor-host-core`), and `electronVersion` is
pinned in the config because `electron` is declared as a range.

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

The chat loop has its own opt-in check (streaming, JSONL persistence, history
reload and reopening the same transcript):

```bash
PICTOR_LIVE_CHAT=1 \
PICTOR_LIVE_BASE_URL=https://api.example.com/v1 \
PICTOR_LIVE_MODEL=<model-id> \
PICTOR_LIVE_API_KEY=<key> \
pnpm vitest run packages/chat/src/live.test.ts
```

## CI

`.github/workflows/ci.yml` runs on Node 22.22.2 and stable Rust:

```text
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```
