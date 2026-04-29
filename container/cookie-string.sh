#!/bin/bash
# cookie-string — flatten a saved Playwright storageState into a single-line
# Cookie header value (`name=val; name=val; ...`) suitable for HTTP requests
# and Scrapfly's `cookies` parameter.
#
# Usage:
#   cookie-string <domain>           # e.g. cookie-string bloomberg.com
#   cookie-string <domain>#<label>   # e.g. cookie-string substack.com#work
#
# Reads /workspace/agent/browser-states/index.json. Exits non-zero with a
# stderr message if:
#   - no entry for the domain (or label),
#   - the entry has `suspect: true` (don't burn fresh requests on a known-bad session).
#
# Writes the cookie string to stdout. The agent captures stdout and passes
# it to the Scrapfly MCP tool's `cookies` parameter.

set -euo pipefail

INDEX="${BROWSER_STATES_DIR:-/workspace/agent/browser-states}/index.json"
KEY="${1:-}"

if [ -z "$KEY" ]; then
  echo "usage: cookie-string <domain>[#<label>]" >&2
  exit 2
fi

if [ ! -f "$INDEX" ]; then
  echo "no browser-states index at $INDEX (no /add-site-login captures yet)" >&2
  exit 1
fi

# Fetch the entry. jq returns null for missing keys; check.
entry="$(jq -c --arg k "$KEY" '.[$k] // empty' "$INDEX")"
if [ -z "$entry" ]; then
  echo "no saved login for \"$KEY\" in $INDEX" >&2
  exit 1
fi

suspect="$(jq -r '.suspect // false' <<<"$entry")"
if [ "$suspect" = "true" ]; then
  reason="$(jq -r '.suspectReason // "unspecified"' <<<"$entry")"
  at="$(jq -r '.suspectAt // "unknown"' <<<"$entry")"
  echo "saved login for \"$KEY\" is marked suspect ($reason at $at) — refresh via /add-site-login before retrying" >&2
  exit 3
fi

file="$(jq -r '.file' <<<"$entry")"
state_path="$(dirname "$INDEX")/$file"
if [ ! -f "$state_path" ]; then
  echo "state file referenced by index is missing: $state_path" >&2
  exit 1
fi

# Build the Cookie header value.
jq -r '.cookies | map("\(.name)=\(.value)") | join("; ")' "$state_path"
