---
status: accepted
supersedes: ADR-0001
---

# Arch support and portable AppImage

Pictor formally supports Windows 11 x64 and native Arch Linux x64 on a dated niri Wayland acceptance baseline. Linux releases contain a native Pacman package for that supported environment and a portable x64 AppImage for convenience on other distributions; the AppImage carries no general Linux compatibility promise. Ubuntu is no longer a Supported Distribution, although an Ubuntu hosted runner may remain build infrastructure. This supersedes ADR-0001 and removes the deb package and Ubuntu acceptance lifecycle.
