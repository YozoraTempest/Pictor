# Composition

Pictor is an all-in-one: software is assembled into it as plugins, through cordis.

This document says what gets assembled, what the shell owns, and where the seams are —
because the first thing assembled happened to be an agent runtime, and it is easy to mistake
that for what Pictor is.

## What Pictor is

A window, a conversation store, a configuration surface, and a plugin tree. Nothing else.

Everything a person _uses_ — an agent runtime, a markdown editor, git, a browser — is
software assembled in as a plugin. **dsh** (DeepSeek Harness) was the first; it is an ars
called `ars.dsh`. It will not be the last, and the next one will not be an agent.

## One kind of thing

A plugin is a cordis plugin: `name`, `inject`, `apply(ctx)`, registrations owned by
`ctx.effect`. There is one tree, one loading contract, one lifecycle.

What a plugin _provides_ decides what it becomes. That is a fact about the plugin, not a
category the host keeps:

| It provides                                                                       | It becomes                              |
| --------------------------------------------------------------------------------- | --------------------------------------- |
| `pictor.*` contributions (panels, views, slots, guards, hooks, toolViews, skills) | something that draws in the window      |
| `ars.<id>` service                                                                | an ars: one piece of assembled software |
| its own service (`editor.markdown`, `git.repo`, …)                                | something other plugins can `inject`    |
| more than one of the above                                                        | one package doing several things        |

**An ars is not a category.** It is a plugin that publishes a service, `ars.<id>` — dsh is
one, an editor is one. What makes conversations possible is narrower: an ars may _also_
implement the driver contract, `ArsDriver` (`packages/ars-sdk/src/driver.ts`), which is one
contract among future ones and rich only because it is the most developed integration.

The code already works this way. A built-in ars and a plugin directory take the same path:
`ctx.plugin()` into the same `Context`, the same `inject` semantics, the same disposal. The
only difference is where the module comes from:

```ts
// compiled in
entry: { load: async () => (await import('@pictor/ars-dsh')).dshArs }
// on disk
discoverPlugins([...]) → parseArsContribution
```

## What the host owns

The host is the part that is not a plugin, and it should stay small enough to describe in one
breath:

- **The window**: shell, navigation, panels, the six slots, the transcript.
- **The conversation store**: sessions, titles, branches, archives, which ars executes which
  conversation (SQLite, `crates/host-core`).
- **Configuration and secrets**: providers, model choices, MCP servers, tool rules.
- **The plugin runtime**: discovery, mounting, hot reload, one tree.
- **The sockets** — the only places a plugin can reach across a boundary:

| Socket          | What crosses it                          | State                   |
| --------------- | ---------------------------------------- | ----------------------- |
| UI              | `views` blocks, `panels`, `slots`        | exists                  |
| Front end       | a sandboxed frame with a message channel | exists                  |
| Tools           | a tool the model can call                | **missing**             |
| Navigation      | a destination in the rail                | **built from ars only** |
| Loopback bridge | guards, hooks, providers                 | exists (JSON by `kind`) |

The bridge is the shape every future socket should copy: one loopback socket, requests tagged
by `kind`, the app answering with its own services, and an ars-side adapter that speaks its
host's API.

## What stays with plugins

- **Content data.** The host stores conversations. A document, a draft, a repository index —
  that is the plugin's own data, under its `dataDirectory`. Putting plugin content into the
  conversation store would make every future kind of software a change to the store.
- **Composition between plugins.** If an editor publishes `editor.markdown` and a tool plugin
  wants to read markdown, the tool plugin injects it. Cordis does this already; the host has
  no reason to sit in the middle.
- **Which software is worth integrating.** The host ships sockets, not integrations.

## Naming

The word matters: the host API is a description of what Pictor thinks exists.

- **ars** — a piece of software assembled in and published as one service, `ars.<id>`: dsh
  (an agent runtime), an editor, git. The word is Pictor's own; _harness_ stays where the
  software already uses it, in dsh's full name.
- **plugin** — the thing that gets assembled. An ars is one; so are panels and guards.
- **host** — the shell: window, store, configuration, plugin runtime, sockets.

The code says _kernel_ where it means _ars_: `kernel.<id>` services, `KernelDriver`,
`KernelCapabilities`, `@pictor/kernel-*`, `Session.kernelId`, and 「内核」 in the window. That
rename is scheduled as **R0** below; it has not been done.

Choosing _ars_ also settles a collision: `@pictor/harness` keeps its meaning as the dsh
_transport_ (`packages/harness` — RACP frames over HTTP/WS) and does not have to move.

## Where the code is still shaped by the first ars

Honest inventory. None of this is wrong today — there is one ars and it works — but each line
blocks a second kind of software.

| Place                                             | What it assumes                                               | What it blocks                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `viewsFor()` (`app/views.tsx`)                    | the rail is _home + one page per ars + extensions + settings_ | a plugin that is not an ars cannot get a destination without pretending to be one      |
| `Session.kernelId`                                | a conversation has an executor                                | fine as is — it is _only_ about conversations; documents have no home here             |
| `KernelCapabilities`                              | permission, approval, skills, fork, commands, jobs            | reads like "plugin capabilities"; it is one contract's, and others must not inherit it |
| `listKernels`, `kernelViewId`, `setDefaultKernel` | ars are a first-class noun in the host API                    | new surfaces should not grow the same prefix                                           |

## Boundaries

1. **The host ships sockets, never capabilities.** No specific software, no specific tool, no
   built-in integration.
2. **Plugins are peers.** An ars is not a privileged plugin; it provides a service like any
   other, and it is listed, installed and switched like any other.
3. **Plugins compose through cordis.** The host does not mediate between two plugins.
4. **Nothing crosses a boundary without a socket.** A capability with no socket is a
   capability plugins cannot have — so adding one is host work, and is the only kind of host
   work that grows the product.
5. **The window draws.** A plugin supplies data (blocks) or its own sandboxed front end; it
   never renders in the shell.
6. **Permissions have no bypass.** A tool a plugin provides is subject to the same rules and
   guards as one the ars ships. A tool that mutates is refused in a read-only conversation, by
   the host, before the ars sees it.
7. **Content belongs to plugins, conversations to the host.**

## Plan

Ordered by what can be verified, not by what is interesting.

**P0 — this document.** No code. It exists so the next decisions are made against a model
instead of against the last feature.

**R0 — the rename.** `kernel` → `ars` everywhere it names the concept: the service prefix
(`ars.<id>`), the contract types (`ArsDriver`, `ArsCapabilities`), the package names
(`@pictor/ars-*`), `Session`'s field (schema v8 renames the column), the host API, and the
window's wording. Mechanical, but it changes the public contract, so it goes first — before
more surface is built on the wrong word.

**P1 — the tools socket.** `pictor.tools({ name, description, schema, mutating, run })`, a
`kind: 'tools'` / `kind: 'run'` pair on the existing bridge, one adapter per ars (dsh:
`ctx.tools.register`; Pi: `pi.registerTool`), and `capabilities.tools` so an ars that cannot
register declares it and the tools simply do not appear.
_Acceptance:_ a conversation on either ars calls a plugin-provided read-only tool; a read-only
conversation refuses a mutating one with a reason; an unreachable bridge leaves the tool
unregistered rather than failing at call time.

**P2 — navigation as a socket.** The rail built from destinations, of which "one page per ars"
is one provider and plugin pages another. `slots.main` already draws a keyed page; what is
missing is the step from "drawn" to "in the rail".
_Acceptance:_ built-in ars keep a page each; a plugin page appears in the rail, opens, and
disappears when the plugin is switched off.

**P3 — one list.** Built-in ars appear as ordinary plugin rows, saying what they are
(`随应用提供 · provides ars.dsh · cannot be removed`) instead of living in a separate group.

**P4 — the second kind of software.** When a markdown editor (or git, or a browser) is
assembled in, it is the test of R0–P3. If a contract is missing — an editor contract, say — it
gets designed _then_, with a real integration to check it against. Not before: a contract
invented for an imagined second user is a contract that fits neither.

## What this does not decide

- **Whether built-in ars become installable packages.** A packaging question (runtime
  resolution of `@pictor/ars-sdk`), not an architectural one. The model above is unaffected by
  the answer.
- **Whether the host ever runs an agent loop.** It does not today; nothing here requires it to.
- **How many contracts there will be.** One is defined. The rest arrive with their software.
