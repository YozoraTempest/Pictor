---
status: accepted
---

# Trusted React Renderer Plugins

Pictor treats Renderer Plugins as trusted code in the Core Host renderer realm and uses the shared Core React runtime as their versioned View Interface. A framework-neutral Web Component layer, a declarative UI schema, and untrusted Plugin isolation are rejected for this Interface because React is the only real Renderer Adapter and the first customization audience is local power users and Plugin developers; untrusted distribution remains a separate future decision.
