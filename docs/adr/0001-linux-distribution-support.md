---
status: accepted
---

# Linux distribution support for Pictor 0.2

Pictor 0.2 formally supports Ubuntu 24.04 LTS x64 and native Arch Linux x64 as separate Supported Distributions. The same release publishes a native `.deb` for Ubuntu and a Pacman package for Arch instead of using one AppImage to imply generic Linux compatibility, because each support promise needs an explicit dependency, installation, update-selection, and desktop acceptance baseline. Ubuntu is accepted on an Ubuntu 24.04 hosted runner with Xvfb, full Electron E2E, and the complete deb lifecycle; a separate physical GNOME Wayland acceptance is not required. Arch is accepted against a dated rolling snapshot on niri Wayland. Other Linux distributions, Arch derivatives, arm64, package repositories, and package signing are outside this decision.
