#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point; Python also runs natively on Windows.
exec python3 "$(dirname "$0")/package.py" "$@"
