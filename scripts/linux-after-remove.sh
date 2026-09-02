#!/usr/bin/env bash

set -euo pipefail

launcher='/usr/bin/pictor'
target='/opt/Pictor/pictor'

if [[ -L "$launcher" && "$(readlink -- "$launcher")" == "$target" ]]; then
  rm -- "$launcher"
fi
