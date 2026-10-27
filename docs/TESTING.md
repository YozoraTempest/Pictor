# Testing and CI

## What gets a test

The suite exists to catch the failures this project actually has, not to describe
the code. Three questions decide where a check goes:

1. **Does the code branch?** Pure functions that make decisions — grouping,
   protocol framing, event mapping, path resolution, migrations — are unit tested
   against their branches and edge cases.
2. **Does data change shape at the seam?** A wire event becoming a transcript row,
   a manifest becoming a plugin record, a profile patch becoming a file: these
   are unit tested with a fake at the boundary, because the bug they hide is a
   mismatch, not a computation.
3. **Can only a running app show it?** Streaming, persistence across restarts,
   window-level behaviour: end-to-end specs, because every earlier attempt to
   cover them with fakes passed while the feature was broken.

Everything else stays untested on purpose:

- **Prop passthrough** (`<Panel title>` renders a heading), because the type
  already says it and the browser shows it in a second.
- **Class names and style strings** (`opacity-0` → `opacity-100` on hover), which
  change with the design and prove nothing about behaviour.
- **Constants and lookup tables**, unless the fallback is the interesting branch.
- **Facts the compiler guarantees**, such as a registry entry having the shape its
  interface declares.
- **Third-party behaviour** — the runtime, the model SDK, `jsdom` itself.

A test that would pass no matter which branch the code takes is deleted rather
than kept for its count.

## Commands

| Purpose                        | Command                                            |
| ------------------------------ | -------------------------------------------------- |
| Format, types, lint, all tests | `pnpm verify`                                      |
| JS/TS tests                    | `pnpm test:js`                                     |
| Rust tests                     | `pnpm test:rust`                                   |
| Type check only                | `pnpm typecheck`                                   |
| Lint only                      | `pnpm lint`                                        |
| Production build               | `pnpm build`                                       |
| End-to-end specs               | `pnpm test:e2e`                                    |
| One unit test file             | `pnpm vitest run packages/racp/src/client.test.ts` |
| One spec                       | `pnpm test:e2e chat`                               |

## Unit tests

| Layer         | Location                                           | Covers                                                                                                                                          |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Core packages | `packages/*/src/**/*.test.ts`                      | RACP framing, the host client, profile locking, plugin resolution and lifecycle, the `@pictor/harness` wire protocol, provider and auth storage |
| Main process  | `apps/desktop/src/main/*.test.ts`                  | The runtime event bridge, history projection, the profile patch, tool guards, title adoption                                                    |
| Renderer      | `apps/desktop/src/renderer/src/**/*.test.{ts,tsx}` | Session grouping, transcript turns, stores, presenters, settings schema, and the few components whose logic is not layout                       |
| Rust          | `crates/host-core`                                 | Migrations, store operations, JSON-RPC dispatch                                                                                                 |

Tests use temporary directories and injected fakes (a fake socket for the mux, a
fake transport for RPC) and never touch the real profile or a network endpoint.
The runtime is exercised through its wire format, not by booting it.

## End-to-end specs

```bash
pnpm build          # the specs drive the built app, not the sources
pnpm test:e2e       # every spec
```

`e2e/harness.mjs` launches the real application: `PICTOR_USER_DATA` points at a
throwaway profile, a scratch directory stands in for a project, and the spec talks
to the window over CDP with Electron's own Chromium (`playwright-core`, no browser
download). Nothing is stubbed below the window.

Each spec says what it is about:

| Spec       | Proves                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`     | A message typed into the composer reaches the runtime, streams back, the runtime's title is adopted, and the conversation survives a restart       |
| `probe`    | 试运行 returns the runtime's answer and events, and with the runtime down a message is refused instead of being answered elsewhere                 |
| `branch`   | Branching from an answer and before a question copies exactly the expected prefix, and the tree shows both conversations under their source        |
| `approval` | A sandbox denial escalates into a question, and the answer decides whether the file exists                                                         |
| `image`    | A pasted image reaches the model as an image part, survives into the bubble, and a non-image paste attaches nothing                                |
| `archive`  | Archiving is undoable from the row that did it, and a sweeping archive asks first                                                                  |
| `search`   | The palette narrows as you type, land on a conversation, open and close on the advertised keys                                                     |
| `actions`  | A button's action id reaches the plugin in the main process, and the description it answers with replaces what was drawn                           |
| `frame`    | A plugin's own bundle loads in a sandboxed frame with its stylesheet, its click reaches the plugin and comes back, and it cannot reach the network |

`e2e/stub-model.mjs` is a local OpenAI-compatible endpoint, so the chat spec
asserts Pictor's behaviour and never a provider's output. It answers the runtime's
titling request separately, which is what makes the adopted-title check meaningful.

**The runtime is not installed by e2e.** A conversation needs the pinned
`@deepseek-ai/dsh` package, which the app itself installs into a profile (about
900 MB). The harness uses a runtime that already exists — `PICTOR_DSH_BIN`, or the
one in the current profile — and the specs that need a turn return `{ skip }` when
there is none. `PICTOR_E2E_STRICT=1` turns that skip into a failure, so CI cannot lose the
coverage silently.

Other knobs, all optional: `PICTOR_E2E_ELECTRON_ARGS` passes extra Chromium
switches (CI needs `--no-sandbox`), and `PICTOR_NODE_BIN` tells the app which Node
to boot the runtime with when the machine has several.

Specs need a display; on a headless machine run them under `xvfb-run -a`. They are
deliberately **not** part of `pnpm verify`: they are slower, and they belong in a
job of their own.

## Packaging

```bash
pnpm pack:dir    # unpacked app under dist/<platform>-unpacked
pnpm pack:dist   # installer under dist/
```

Both run `pnpm build` first. The packager needs two things it cannot infer: the
Rust binary is not an npm package (it ships as
`resources/host-core/pictor-host-core`), and `electronVersion` is pinned in the
config because `electron` is declared as a range.

The packaged app can be started without a window, which is how CI proves the
sidecar resolution that only exists inside a package:

```bash
PICTOR_SMOKE=1 PICTOR_USER_DATA="$(mktemp -d)" dist/linux-unpacked/pictor
```

It prints `pictor host core …` and `[smoke] window loaded`, then exits. It waits
for the document rather than `ready-to-show`, because a headless machine never
paints.

## Live probes (manual)

Opt-in checks against a real endpoint, skipped unless the environment says
otherwise. No endpoint or key is ever committed:

```bash
PICTOR_LIVE_TEST=1 PICTOR_LIVE_BASE_URL=… PICTOR_LIVE_MODEL=… PICTOR_LIVE_API_KEY=… \
  pnpm vitest run packages/model-config/src/live.test.ts   # /models + one completion
```

The full chat loop is a spec, not a live test: `pnpm test:e2e chat` runs a real
turn through the runtime against a local stub endpoint.

They are the only way to see a real provider refuse a request — a base URL that
needs `/anthropic` rather than `/v1`, for instance. They are never part of CI.

## CI

`.github/workflows/ci.yml` runs three jobs on Node 22.22.2 and stable Rust. All
three are required:

| Job       | Runs                                                                | Proves                                                         |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `verify`  | `pnpm install`, `pnpm verify`, `pnpm build:js`                      | Formatting, types, lint, unit tests and Rust tests are clean   |
| `e2e`     | `pnpm build`, then `xvfb-run pnpm test:e2e` with a cached runtime   | The app works as a whole: composer, runtime, streaming, reopen |
| `package` | `pnpm pack:dir`, then a `PICTOR_SMOKE` start of the packaged binary | The sidecar ships, the executable is named right, it boots     |

`e2e` installs the runtime into `~/.cache/pictor-dsh` behind an `actions/cache`
keyed by the pinned version, so only a version bump pays the download. `verify`
and `package` never need it.

Reproduce CI locally:

```bash
pnpm verify
xvfb-run -a env PICTOR_E2E_STRICT=1 PICTOR_E2E_ELECTRON_ARGS=--no-sandbox pnpm test:e2e
pnpm pack:dir && PICTOR_SMOKE=1 PICTOR_USER_DATA="$(mktemp -d)" dist/linux-unpacked/pictor
```
