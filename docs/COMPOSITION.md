# Composition

Pictor is a shell and an assembly machine. This document says what gets assembled, what
the shell owns, and where the seams are — because the first thing assembled happened to be
an agent runtime, and it is easy to mistake that for what Pictor is.

## What Pictor is

A window, a conversation store, a configuration surface, and a plugin tree. Nothing else.

Everything a person _uses_ — an agent runtime, a markdown editor, git, a browser — is
software assembled in as a plugin. dsh was the first. It will not be the last, and the next
one will not be an agent.

## One kind of thing

A plugin is a cordis plugin: `name`, `inject`, `apply(ctx)`, registrations owned by
`ctx.effect`. There is one tree, one loading contract, one lifecycle.

What a plugin _provides_ decides what it becomes. That is a fact about the plugin, not a
category the host keeps:

| It provides                                                                       | It becomes                           |
| --------------------------------------------------------------------------------- | ------------------------------------ |
| `pictor.*` contributions (panels, views, slots, guards, hooks, toolViews, skills) | something that draws in the window   |
| `kernel.<id>` service                                                             | an agent runtime                     |
| its own service (`editor.markdown`, `git.repo`, …)                                | something other plugins can `inject` |
| more than one of the above                                                        | one package doing several things     |

**A kernel is not a category.** It is a service name. `KernelDriver`
(`packages/kernel-sdk/src/driver.ts`) is one contract among future ones — a rich one,
because it is the most developed integration, not because agent runtimes outrank editors.

The code already works this way. A built-in kernel and a plugin directory take the same
path: `ctx.plugin()` into the same `Context`, the same `inject` semantics, the same
disposal. The only difference is where the module comes from:

```ts
// compiled in
entry: { load: async () => (await import('@pictor/kernel-dsh')).dshKernel }
// on disk
discoverPlugins([...]) → parseKernelContribution
```

## What the host owns

The host is the part that is not a plugin, and it should stay small enough to describe in
one breath:

- **The window**: shell, navigation, panels, the six slots, the transcript.
- **The conversation store**: sessions, titles, branches, archives, which kernel executes
  which conversation (SQLite, `crates/host-core`).
- **Configuration and secrets**: providers, model choices, MCP servers, tool rules.
- **The plugin runtime**: discovery, mounting, hot reload, one tree.
- **The sockets** — the only places a plugin can reach across a boundary:

| Socket          | What crosses it                          | State                   |
| --------------- | ---------------------------------------- | ----------------------- |
| UI              | `views` blocks, `panels`, `slots`        | exists                  |
| Front end       | a sandboxed frame with a message channel | exists                  |
| Tools           | a tool the model can call                | **missing**             |
| Navigation      | a destination in the rail                | **kernel-only today**   |
| Loopback bridge | guards, hooks, providers                 | exists (JSON by `kind`) |

The bridge is the shape every future socket should copy: one loopback socket, requests
tagged by `kind`, the app answering with its own services, and a kernel-side adapter that
speaks its host's API.

## What stays with plugins

- **Content data.** The host stores conversations. A document, a draft, a repository
  index — that is the plugin's own data, under its `dataDirectory`. Putting plugin content
  into the conversation store would make every future kind of software a change to the
  store.
- **Composition between plugins.** If an editor provides `editor.markdown` and a tool
  plugin wants to read markdown, the tool plugin injects it. Cordis does this already; the
  host has no reason to sit in the middle.
- **Which software is worth integrating.** The host ships sockets, not integrations.

## Where the code is still kernel-shaped

Honest inventory. None of this is wrong today — there is one agent runtime and it works —
but each line blocks a second kind of software.

| Place                                             | What it assumes                                                  | What it blocks                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `viewsFor()` (`app/views.tsx`)                    | the rail is _home + one page per kernel + extensions + settings_ | an editor cannot get a rail destination without pretending to be a kernel                                 |
| `Session.kernelId`                                | a conversation has an executor                                   | fine as is — but it is _only_ about conversations; documents have no home and should not get one here     |
| `KernelCapabilities`                              | permission, approval, skills, fork, commands, jobs               | reads like "plugin capabilities"; it is the agent contract's, and a second contract should not inherit it |
| `listKernels`, `kernelViewId`, `setDefaultKernel` | kernels are a first-class noun in the host API                   | new surfaces should not grow the same prefix                                                              |

## Boundaries

1. **The host ships sockets, never capabilities.** No specific software, no specific tool,
   no built-in integration.
2. **Plugins are peers.** A kernel is not a privileged plugin; it provides a service like
   any other, and it is listed, installed and switched like any other.
3. **Plugins compose through cordis.** The host does not mediate between two plugins.
4. **Nothing crosses a boundary without a socket.** A capability with no socket is a
   capability plugins cannot have — so adding one is host work, and is the only kind of
   host work that grows the product.
5. **The window draws.** A plugin supplies data (blocks) or its own sandboxed front end;
   it never renders in the shell.
6. **Permissions have no bypass.** A tool a plugin provides is subject to the same rules and
   guards as one the kernel ships. A tool that mutates is refused in a read-only
   conversation, by the host, before the kernel sees it.
7. **Content belongs to plugins, conversations to the host.**

## Plan

Ordered by what can be verified, not by what is interesting.

**P0 — this document.** No code. It exists so the next four decisions are made against a
model instead of against the last feature.

**P1 — the tools socket.** `pictor.tools({ name, description, schema, mutating, run })`, a
`kind: 'tools'` / `kind: 'run'` pair on the existing bridge, one adapter per kernel (dsh:
`ctx.tools.register`; Pi: `pi.registerTool`), and `capabilities.tools` so a runtime that
cannot register declares it and the tools simply do not appear.
_Acceptance:_ a conversation on either kernel calls a plugin-provided read-only tool; a
read-only conversation refuses a mutating one with a reason; an unreachable bridge leaves
the tool unregistered rather than failing at call time.

**P2 — navigation as a socket.** The rail built from destinations, of which "one page per
kernel" is one provider and plugin pages another. `slots.main` already draws a keyed page;
what is missing is the step from "drawn" to "in the rail".
_Acceptance:_ built-in kernels keep a page each; a plugin page appears in the rail, opens,
and disappears when the plugin is switched off.

**P3 — one list.** Built-in kernels appear as ordinary plugin rows, saying what they are
(`随应用提供 · provides kernel.dsh · cannot be removed`) instead of living in a separate
group.

**P4 — the second kind of software.** When a markdown editor (or git, or a browser) is
assembled in, it is the test of P1–P3. If a contract is missing — an editor contract, say —
it gets designed _then_, with a real integration to check it against. Not before: a contract
invented for an imagined second user is a contract that fits neither.

## What this does not decide

- **Whether built-in kernels become installable packages.** A packaging question (runtime
  resolution of `@pictor/kernel-sdk`), not an architectural one. The model above is
  unaffected by the answer.
- **Whether the host ever runs an agent loop.** It does not today; nothing here requires it
  to.
- **How many contracts there will be.** One is defined. The rest arrive with their software.
