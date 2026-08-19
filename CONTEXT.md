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
