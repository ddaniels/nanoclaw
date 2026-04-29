#!/bin/bash
# mark-login-suspect — flag a saved login as burned/expired so the agent
# stops trying to use it until /add-site-login refreshes it.
#
# Usage:
#   mark-login-suspect <domain>[#<label>] [reason]
# Examples:
#   mark-login-suspect bloomberg.com "scrapfly returned PerimeterX block"
#   mark-login-suspect substack.com#work "paywall on /p/* despite saved cookies"
#
# Updates /workspace/agent/browser-states/index.json: sets
#   { "suspect": true, "suspectAt": "<iso8601>", "suspectReason": "<reason>" }
# on the matching entry. Atomic via temp-file + mv.

set -euo pipefail

INDEX="${BROWSER_STATES_DIR:-/workspace/agent/browser-states}/index.json"
KEY="${1:-}"
REASON="${2:-blocked}"

if [ -z "$KEY" ]; then
  echo "usage: mark-login-suspect <domain>[#<label>] [reason]" >&2
  exit 2
fi
if [ ! -f "$INDEX" ]; then
  echo "no browser-states index at $INDEX" >&2
  exit 1
fi

# Verify the key exists.
if [ "$(jq -r --arg k "$KEY" 'has($k)' "$INDEX")" != "true" ]; then
  echo "no saved login for \"$KEY\" in $INDEX" >&2
  exit 1
fi

now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
tmp="$(mktemp "${INDEX}.XXXXXX")"
jq --arg k "$KEY" --arg t "$now" --arg r "$REASON" \
  '.[$k] += {suspect: true, suspectAt: $t, suspectReason: $r}' \
  "$INDEX" > "$tmp"
chmod 0600 "$tmp"
mv "$tmp" "$INDEX"

echo "marked $KEY suspect ($REASON at $now)"
