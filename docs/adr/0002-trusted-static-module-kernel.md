---
status: accepted
---

# Trusted static Module Kernel

Pictor uses a minimal build-time Module Kernel for trusted in-repository features. The Kernel only orders explicit dependencies, exposes provided interfaces, collects contributions, and disposes resources; it does not implement permissions, sandboxing, dynamic installation, interface version negotiation, or a third-party plugin host. This keeps feature development fast while leaving external plugins as a separate future decision after a real second implementation appears.
