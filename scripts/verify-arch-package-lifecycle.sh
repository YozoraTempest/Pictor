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
    test -x /opt/Pictor/pictor-gui
    test -f /opt/Pictor/resources/app.asar
    test -d /opt/Pictor/resources/bundled-plugins
    test -x /usr/bin/pictor
    test -f /usr/share/applications/pictor.desktop

    command_cwd="/tmp/Pictor package cwd"
    mkdir -p "$user_data" "$command_cwd"
    export PATH="/usr/bin:/bin"
    test ! -e /usr/bin/node
    /usr/bin/pictor cli --help > /tmp/pictor-cli-help.txt 2>&1
    grep -F "Usage: pictor cli" /tmp/pictor-cli-help.txt
    /usr/bin/pictor tui --help > /tmp/pictor-tui-help.txt 2>&1
    grep -F "Usage: pictor tui" /tmp/pictor-tui-help.txt
    (cd "$command_cwd" && /usr/bin/pictor cli --user-data-dir "$user_data" doctor) > /tmp/pictor-cli-doctor.txt 2>&1
    grep -F "Doctor:" /tmp/pictor-cli-doctor.txt
    (cd "$command_cwd" && /usr/bin/pictor tui --non-interactive --user-data-dir "$user_data") > /tmp/pictor-tui-start.txt 2>&1
    grep -F "Pictor TUI 首次使用" /tmp/pictor-tui-start.txt
    test ! -e "$user_data/.pictor-profile.lock"
    touch "$user_data/keep-after-uninstall"
    pacman -Rns --noconfirm pictor

    ! pacman -Q pictor
    test ! -e /opt/Pictor/pictor
    test ! -e /opt/Pictor/pictor-gui
    test ! -e /usr/bin/pictor
    test ! -e /usr/share/applications/pictor.desktop
    test -f "$user_data/keep-after-uninstall"
  '
