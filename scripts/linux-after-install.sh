#!/usr/bin/env bash

set -euo pipefail

launcher='/usr/bin/pictor'
target='/opt/Pictor/pictor'

if [[ -e "$launcher" && ! -L "$launcher" ]]; then
  echo "Refusing to replace a non-Pictor launcher at $launcher" >&2
  exit 1
fi
if [[ -L "$launcher" && "$(readlink -- "$launcher")" != "$target" ]]; then
  echo "Refusing to replace an unrelated launcher at $launcher" >&2
  exit 1
fi
if [[ ! -L "$launcher" ]]; then
  ln -s -- "$target" "$launcher"
fi
