#!/usr/bin/env bash
# Deprecated alias — use scripts/update.sh or ./update.sh
exec bash "$(cd "$(dirname "$0")" && pwd)/update.sh" "$@"
