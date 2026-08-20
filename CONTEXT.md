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
The immutable Pictor desktop foundation that remains available when no optional product capability is installed.
_Avoid_: Core Plugin, Built-in Plugin

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

**Pi Session Fork**:
A new independent Pi Session created from one entry in existing Pi Session History through Pi's native Fork lifecycle.
_Avoid_: Session Tree selection, in-place branch switch, copied GUI history

**Pi Session Clone**:
A new independent Pi Session containing the active branch through the current leaf of existing Pi Session History.
_Avoid_: Historical Fork, same-file branch, copied GUI history

**Legacy Session Import**:
A preserved pre-authority Pictor Session awaiting explicit conversion into Pi Session History.
_Avoid_: Automatic migration, discarded old Session
