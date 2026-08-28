# Pictor Domain Language

This glossary defines the product language used to describe Pictor's desktop support and releases.

## Language

**Supported Platform**:
An operating-system and CPU-architecture combination for which Pictor maintains one or more Supported Distributions.
_Avoid_: End, client, generally supported system

**Supported Distribution**:
A Linux distribution for which Pictor publishes a native Release Asset and maintains an explicit Acceptance Baseline.
_Avoid_: Compatible distro, Linux in general

**Acceptance Baseline**:
The canonical environment used to substantiate a Supported Platform or Supported Distribution. Environments outside the baseline are not implicitly covered by the same support promise.
_Avoid_: Recommended system, any compatible distribution

**Release Asset**:
A platform-specific Pictor distribution attached to a formal product release.
_Avoid_: Build output, preview artifact

**Portable Linux Asset**:
An AppImage published for convenient use on x64 Linux without implying a Supported Distribution or compatibility promise.
_Avoid_: Universal Linux package, Supported Distribution

**Command Interpreter**:
The deterministic shell environment used to execute an individually approved Agent command. It is independent of the user's login shell.
_Avoid_: Terminal, user shell, Git Bash

**Core Host**:
The immutable Pictor desktop foundation that remains available when no optional product capability is installed. It owns recovery and the generic Workbench, but no Project, Session, or Agent workflow.
_Avoid_: Core Plugin, Built-in Plugin

**Workbench**:
The user-customizable desktop environment that arranges and hosts View Instances created from Plugin-contributed View Definitions.
_Avoid_: Shell Application, fixed page layout, window manager

**View Definition**:
A Plugin-contributed description from which the Workbench creates View Instances.
_Avoid_: React component, fixed slot, View Instance

**View Instance**:
A uniquely identified user-visible work surface created from one View Definition. It belongs to exactly one Workbench Window at a time.
_Avoid_: React component instance, page, View Definition

**Workbench Window**:
A native Pictor window with stable identity and independent View arrangement, focus, and Project or Session selection.
_Avoid_: Workspace, primary window, secondary window

**Workbench Configuration**:
User-authored policy and defaults for composing the Workbench.
_Avoid_: Workbench State, UI database, Plugin Profile

**Workbench State**:
The persisted Workbench Windows, View Instance identities, placement, sizing, visibility, and focus of a user's Workbench.
_Avoid_: Workbench Configuration, layout config

**Workbench Action**:
A user-invocable operation registered with the Workbench and available to interaction mechanisms such as key bindings.
_Avoid_: UI Command, Pi command, shell command

**Active View Instance**:
The View Instance selected for Workbench navigation and Action context in one Workbench Window. It is independent of focus within the View's rendered content.
_Avoid_: DOM focus, active element, selected Session

**Workbench Preset**:
A named Plugin-contributed starting composition for a Workbench Window.
_Avoid_: Profile, hard-coded layout, Workbench State

**Core Recovery Preset**:
The Core Host Workbench Preset that exposes diagnostics and Plugin management when normal composition cannot load.
_Avoid_: silent fallback, Agent Workspace, safe mode

**Missing View**:
A retained View Instance whose View Definition is unavailable.
_Avoid_: removed View, ignored configuration, failed Window

**Plugin**:
An independently installed, versioned, enabled, disabled, or removed Pictor product capability.
_Avoid_: Module, extension point, component

**Bundled Plugin**:
A Plugin whose recovery source ships with Pictor but whose installed copy follows the same lifecycle as any other Plugin.
_Avoid_: Built-in Plugin, system Plugin, permanent Plugin

**Module**:
A process-specific execution part owned by one Plugin. A Module is not independently installed or versioned.
_Avoid_: Plugin, package

**Profile**:
A named recommendation of root Plugins that compose a Pictor product shape without overriding explicit user removals.
_Avoid_: Plugin group, mandatory preset

**Native Pi Extension**:
A Pi Agent Extension installed and executed in its original Pi format without conversion into a Pictor Plugin or Module.
_Avoid_: Pi Plugin wrapper, compatible Plugin

**Pi Session History**:
The authoritative Agent conversation history identified by a Pi Session and preserving its tree, compaction, usage, and extension entries.
_Avoid_: Flat message history, Pictor transcript

**Session Projection**:
A rebuildable desktop representation of Pi Session History used for rendering and navigation.
_Avoid_: Session source of truth, duplicate history

**Session Tree View**:
A read-only desktop view of every branch in Pi Session History. Selecting an entry changes only the displayed Session Projection, never the active Runtime branch.
_Avoid_: Fork, Runtime branch switch, editable history

**Pi Session Active Leaf**:
The entry that defines the current branch context and the parent position for the next appended history entry.
_Avoid_: Selected Tree entry, latest JSONL line

**Pi Session Tree Navigation**:
A same-file change of the Pi Session Active Leaf within existing Pi Session History.
_Avoid_: Session Tree selection, Pi Session Fork, Pi Session Clone

**Pi Session Compaction**:
A summary entry that replaces older active-branch context while preserving the complete Pi Session History.
_Avoid_: History deletion, Branch Summary, transcript truncation

**Pi Branch Summary Navigation**:
A Pi Session Tree Navigation that summarizes the abandoned branch before changing the Pi Session Active Leaf.
_Avoid_: Pi Session Compaction, Fork summary, flattened history

**Session Runtime Controls**:
Per-Session choices for Model, Thinking Level, active Tools, and queued-message delivery that apply when its Pi Runtime is restored.
_Avoid_: Global model credentials, Plugin permissions, TUI settings

**Pi Image Message**:
A User Message containing text and one or more Pi-native image content blocks.
_Avoid_: Project file attachment, image path, embedded Markdown image

**Local Development Plugin**:
A Pictor Plugin whose installed Registry entry points at a live source directory instead of a copied Store package.
_Avoid_: Local Plugin copy, hot reload, Bundled Plugin

**Renderer Plugin**:
A trusted Plugin whose Renderer Module runs in the Core Host renderer realm and contributes Workbench capabilities.
_Avoid_: sandboxed Plugin, Native Pi Extension, WebView Plugin

**Pi Session Fork**:
A new independent Pi Session created from one entry in existing Pi Session History through Pi's native Fork lifecycle.
_Avoid_: Session Tree selection, in-place branch switch, copied GUI history

**Pi Session Clone**:
A new independent Pi Session containing the active branch through the current leaf of existing Pi Session History.
_Avoid_: Historical Fork, same-file branch, copied GUI history

**Pi Session Import**:
A new Pictor Session created from a user-selected Pi JSONL copy and associated with one existing Pictor Project.
_Avoid_: Legacy Session Import, file takeover, in-place migration

**Pi Session Export**:
A standalone current-branch JSONL snapshot or complete-tree HTML document derived from existing Pi Session History.
_Avoid_: Pictor transcript dump, Session copy, source takeover

**Legacy Session Import**:
A preserved pre-authority Pictor Session awaiting explicit conversion into Pi Session History.
_Avoid_: Automatic migration, discarded old Session
