---
status: accepted
---

# Removable Plugin Host

Pictor treats every product capability as a removable Plugin, including the Bundled Plugins shipped with the application. The immutable Core Host only keeps enough desktop infrastructure to start an empty Shell and manage installed extensions; the Plugin Host resolves inter-Plugin dependencies while each Plugin owns an independent process-level Module Kernel, so failure and removal affect only that Plugin and its transitive dependents. Bundled source is a recovery source rather than a privileged lifecycle, and removal preserves Plugin data unless the user explicitly deletes both code and data.
