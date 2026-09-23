#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export PI_CODING_AGENT_DIR="$root/pi/agent"
exec "$root/node_modules/.bin/pi" "$@"
