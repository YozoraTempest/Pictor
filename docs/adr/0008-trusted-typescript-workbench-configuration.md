---
status: accepted
---

# Trusted TypeScript Workbench Configuration

Pictor uses trusted executable TypeScript for user-authored Workbench Configuration instead of JSONC, KDL, or a GUI-owned database. This gives advanced users computed composition and direct reuse while accepting a code-loading and compatibility contract; configuration failure remains subject to explicit Core recovery rather than silent rewriting.
