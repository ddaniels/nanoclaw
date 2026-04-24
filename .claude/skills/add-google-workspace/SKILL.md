---
name: add-google-workspace
description: Add read-only Gmail and Google Calendar MCP tools to the agent. Uses OneCLI apps for OAuth — no secrets in the container, no manual token refresh.
---

# Add Google Workspace (Gmail + Calendar)

Adds read-only access to Gmail and Google Calendar via two lightweight MCP servers inside the agent container. OneCLI handles OAuth (token storage, automatic refresh, per-request injection) — the container never sees credentials.

**Gmail tools:** `gmail_search_threads`, `gmail_get_thread`, `gmail_get_message`, `gmail_get_attachment`, `gmail_list_labels`

**Calendar tools:** `calendar_list_calendars`, `calendar_list_events`, `calendar_get_event`

## Prerequisites

- **OneCLI running** (`onecli agents list` should succeed)
- **Google Cloud project** with OAuth 2.0 credentials (Desktop app type) and Gmail + Calendar APIs enabled

If the user doesn't have a Google Cloud project:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project (or use an existing one)
3. Enable APIs: https://console.cloud.google.com/apis/library/gmail.googleapis.com and https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
4. Create OAuth 2.0 Client ID (application type: Desktop app)
5. Download the client secret JSON file

## Phase 1: Pre-flight

Skip to **Phase 3** if all of these exist:
- `container/agent-runner/src/gmail-mcp-stdio.ts`
- `container/agent-runner/src/calendar-mcp-stdio.ts`

## Phase 2: Apply code changes

### Fetch and copy files

```bash
git fetch origin skill/google-workspace
git show origin/skill/google-workspace:container/agent-runner/src/gmail-mcp-stdio.ts > container/agent-runner/src/gmail-mcp-stdio.ts
git show origin/skill/google-workspace:container/agent-runner/src/gmail-mcp-stdio.test.ts > container/agent-runner/src/gmail-mcp-stdio.test.ts
git show origin/skill/google-workspace:container/agent-runner/src/calendar-mcp-stdio.ts > container/agent-runner/src/calendar-mcp-stdio.ts
git show origin/skill/google-workspace:container/agent-runner/src/calendar-mcp-stdio.test.ts > container/agent-runner/src/calendar-mcp-stdio.test.ts
```

### Build

```bash
pnpm run build
./container/build.sh
```

## Phase 3: Configure OneCLI apps

Ask the user for the path to their Google OAuth client secret JSON file. Read `installed.client_id` and `installed.client_secret` from it.

```bash
onecli apps configure --provider gmail \
  --client-id "${CLIENT_ID}" \
  --client-secret "${CLIENT_SECRET}"

onecli apps configure --provider google-calendar \
  --client-id "${CLIENT_ID}" \
  --client-secret "${CLIENT_SECRET}"
```

Then tell the user:

> Open http://127.0.0.1:10254/connections in your browser. Click Connect for both Gmail and Google Calendar. Sign in with the Google account you want the agent to read.

Wait for the user to confirm both are connected, then verify:

```bash
onecli apps get --provider gmail --fields connection
onecli apps get --provider google-calendar --fields connection
```

Both should show `"status": "connected"`.

## Phase 4: Grant agent access

OneCLI app access must be granted per agent via the web UI (no CLI command exists for this yet). This is a one-time step per agent group — it persists across container restarts.

Find the agent's OneCLI ID:

```bash
onecli agents list
```

Tell the user:

> Open http://127.0.0.1:10254/agents and click Manage on the agent that should have Gmail/Calendar access. Enable the Gmail and Google Calendar apps for this agent.

## Phase 5: Wire MCP servers

Ask which agent group should get Gmail/Calendar access. Add to that group's `groups/<folder>/container.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "bun",
      "args": ["run", "/app/src/gmail-mcp-stdio.ts"],
      "env": {},
      "instructions": "Read-only Gmail access. Use gmail_search_threads with Gmail query syntax to find emails, gmail_get_thread to read full threads, gmail_get_message for a single message, gmail_get_attachment to download attachments, gmail_list_labels to see available labels."
    },
    "calendar": {
      "command": "bun",
      "args": ["run", "/app/src/calendar-mcp-stdio.ts"],
      "env": {},
      "instructions": "Read-only Google Calendar access. Use calendar_list_events to check upcoming events (defaults to next 7 days on primary calendar), calendar_get_event for details on a specific event, calendar_list_calendars to see all calendars."
    }
  }
}
```

Merge these into the existing `mcpServers` object — don't overwrite other entries.

## Phase 6: Build, restart, and verify

1. If Phase 2 was run in this session (new MCP server files were added), rebuild the container image so the files are baked in:
   ```bash
   ./container/build.sh
   ```

2. Clear SDK session for fresh tool discovery:
   ```bash
   find data/v2-sessions -name 'outbound.db' -exec sqlite3 {} "DELETE FROM session_state WHERE key='sdk_session_id';" \;
   ```

3. Stop any running agent containers and restart the service:
   ```bash
   docker stop $(docker ps --format '{{.Names}}' | grep nanoclaw-v2) 2>/dev/null
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
   # systemctl --user restart nanoclaw                # Linux
   ```

4. Ask the user to test: "check my calendar for this week" or "search my email for messages from [someone]"

## How it works

The MCP servers make HTTP requests to `gmail.googleapis.com` and `www.googleapis.com/calendar/v3` without setting Authorization headers. All container HTTP traffic routes through the OneCLI proxy (`HTTPS_PROXY`), which recognizes the connected apps' host patterns and injects the real OAuth Bearer token per request. Token refresh is automatic.

## Troubleshooting

**401 from Gmail/Calendar API** — the app connection may have expired. Check `onecli apps get --provider gmail` — if disconnected, reconnect via the web UI.

**Agent says tools aren't available** — the SDK session was cached from before the MCP servers were added. Clear `session_state` (Phase 6 step 1) and restart the container.

**Agent gets approval popups for every request** — the agent hasn't been granted app access in the OneCLI web UI. See Phase 4.

## Removal

1. Remove `"gmail"` and `"calendar"` from `mcpServers` in the agent group's `container.json`.
2. Delete `container/agent-runner/src/gmail-mcp-stdio.ts`, `calendar-mcp-stdio.ts`, and their test files.
3. Rebuild: `pnpm run build && ./container/build.sh`
4. (Optional) Disconnect apps: `onecli apps disconnect --provider gmail && onecli apps disconnect --provider google-calendar`
