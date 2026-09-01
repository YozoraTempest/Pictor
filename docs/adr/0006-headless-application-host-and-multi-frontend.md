---
status: accepted
---

# Headless Application Host and multi-Frontend composition

Pictor 0.4 uses one headless Application Host and one Command Engine as the shared product core for
GUI, TUI, and CLI Frontends. The GUI Host keeps only the Workbench slot and the built-in Pictor Shell;
all product GUIs, including the Delegate Workbench, belong to removable Plugins. This prevents Electron
Main or one product GUI from becoming the de facto application kernel while keeping Plugin lifecycle,
Agent Workspace state, and Pi Runtime behaviour identical across Frontends.

## Considered options

- Keeping Electron Main and `CoreShell` as the shared core was rejected because CLI and TUI would have
  to start Electron or duplicate application behaviour.
- Reusing CLI or TUI implementation inside Pictor Shell was rejected because a graphical recovery path
  would then inherit terminal parsing, rendering, and lifecycle concerns. All three consume the deeper
  Command Engine interface instead.
- A resident daemon coordinating concurrent Frontends was deferred until a real multi-client need
  exists. In 0.4, commands that access a Profile acquire one exclusive Frontend lock.

## Consequences

Plugin Manifest 0.4 replaces process entries named `main` and `renderer` with `host` and `gui`, and adds
`tui` while retaining `runtime`. Installed 0.3 Plugin packages and Registry entries remain on disk but are
blocked by their existing Pictor engine range until explicitly upgraded; Pictor does not silently rewrite
third-party code. Existing `data-v1`, Pi JSONL authority, credentials, update channels, platforms, and the
default GUI launch remain compatible.
