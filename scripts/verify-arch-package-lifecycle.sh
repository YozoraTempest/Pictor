#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/.." && pwd)"
release_version="${RELEASE_VERSION:-$(node --print "require('$repository_root/package.json').version")}"
package_name="Pictor-$release_version-arch-x64.pacman"

test -f "$repository_root/dist/$package_name"

docker run --rm \
  --env PACKAGE_NAME="$package_name" \
  --volume "$repository_root/dist:/artifacts:ro" \
  archlinux:base \
  bash -euo pipefail -c '
    package_path="/artifacts/$PACKAGE_NAME"
    mapfile -t dependencies < <(bsdtar -xOf "$package_path" .PKGINFO | sed -n "s/^depend = //p")
    user_data=/root/.config/pictor

    pacman -Syu --needed --noconfirm "${dependencies[@]}"
    pacman -U --noconfirm "$package_path"
    pacman -Q pictor
    test -x /opt/Pictor/pictor
    test -x /usr/bin/pictor
    test -f /usr/share/applications/pictor.desktop

    mkdir -p "$user_data"
    touch "$user_data/keep-after-uninstall"
    pacman -Rns --noconfirm pictor

    ! pacman -Q pictor
    test ! -e /opt/Pictor/pictor
    test ! -e /usr/bin/pictor
    test ! -e /usr/share/applications/pictor.desktop
    test -f "$user_data/keep-after-uninstall"
  '
