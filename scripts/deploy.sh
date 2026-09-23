#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
unit_dir="$HOME/.config/systemd/user"
cd "$root"
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
install -d -m 0750 "$unit_dir"
install -m 0644 "$root/deploy/systemd/pi-discord-gateway.service" "$unit_dir/pi-discord-gateway.service"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user daemon-reload
systemctl --user restart pi-discord-gateway.service
systemctl --user is-active pi-discord-gateway.service
