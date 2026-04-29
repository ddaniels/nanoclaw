---
name: add-scrapfly-tool
description: Wire Scrapfly's hosted MCP server into an agent group so the agent can fetch pages from anti-bot-protected sites (Bloomberg, FT, WSJ, NYT, etc.) using captured logged-in cookies. OneCLI vault stores SCRAPFLY_API_KEY; no raw key ever in the container env. Triggers on "add scrapfly", "add scrapfly tool", "wire scrapfly", "let the agent read bloomberg".
---

# Add Scrapfly Tool (OneCLI-native)

This skill wires Scrapfly's official hosted MCP server (`https://mcp.scrapfly.io/mcp`) into selected agent groups. The agent uses Scrapfly when a target URL has a saved login captured by `/add-site-login` — Scrapfly's residential infrastructure clears anti-bot defenses (PerimeterX, Cloudflare, Akamai) that block in-container browsers.

The stdio↔HTTP bridge `mcp-remote` is already installed in the container image (see `container/Dockerfile`). The `SCRAPFLY_API_KEY` env var is set to the literal stub `"onecli-managed"`; OneCLI intercepts outbound traffic to `mcp.scrapfly.io` and injects the real key from the vault at request time.

Tools surfaced to the agent (`mcp__scrapfly__<name>`): `web_get_page`, `web_scrape`, `screenshot`, `cloud_browser_open`, `cloud_browser_navigate`, `cloud_browser_close`, `cloud_browser_sessions`, `info_account`, `check_if_blocked`, `scraping_instruction_enhanced`.

## Phase 1: Provision the Scrapfly account

If the user does not yet have a Scrapfly account:

> Sign up at https://scrapfly.io/. The free tier (1,000 credits/month) is enough for ~40–100 articles per month against a tier-1 anti-bot site like Bloomberg. Anti-Scraping Protection (ASP) — engaged automatically by the MCP — costs roughly 10–25 credits per request on those sites.

After signup, the user retrieves their API key from the Scrapfly dashboard. Don't ask them to paste it into chat — it goes straight into the OneCLI vault.

## Phase 2: Add the API key to the OneCLI vault

```bash
onecli secrets create \
  --name scrapfly-api-key \
  --type bearer-token \
  --value "$SCRAPFLY_API_KEY"   # (user pastes when prompted, do not show in chat)
```

Then attach a host pattern so OneCLI knows when to inject:

```bash
onecli secrets set-host-pattern \
  --secret-id <id-from-create-output> \
  --pattern "mcp.scrapfly.io"
```

Confirm:

```bash
onecli secrets list | grep scrapfly
```

Expected: one entry with host pattern `mcp.scrapfly.io`.

(The exact CLI subcommand spellings may differ between OneCLI versions — check `onecli --help` and `onecli secrets --help` first. The key invariant is a vault entry tagged with the host pattern `mcp.scrapfly.io`.)

## Phase 3: Verify the target agent has the secret assigned

For each agent group that should get Scrapfly access, find the OneCLI agent ID matching the group's `agentGroupId`:

```bash
onecli agents list | grep <agent-group-id>
# or to see what's currently assigned:
onecli agents secrets --id <onecli-agent-id>
```

Either flip the agent to `mode all` (every vault secret with a matching host pattern auto-injects):

```bash
onecli agents set-secret-mode --id <onecli-agent-id> --mode all
```

…or assign the Scrapfly secret explicitly:

```bash
onecli agents set-secrets --id <onecli-agent-id> --secret-ids <scrapfly-secret-id>
```

For new agents the default is `selective` with no secrets assigned, so this step is **required** — without it the container gets `401 Unauthorized` from `mcp.scrapfly.io`. (See CLAUDE.md "Gotcha: auto-created agents start in `selective` secret mode".)

## Phase 4: Wire the MCP server into the agent group's container.json

Open `groups/<folder>/container.json` and add the Scrapfly entry under `mcpServers`:

```json
{
  "mcpServers": {
    "scrapfly": {
      "command": "mcp-remote",
      "args": ["https://mcp.scrapfly.io/mcp"],
      "env": {
        "SCRAPFLY_API_KEY": "onecli-managed"
      }
    }
  }
}
```

The literal string `"onecli-managed"` is a sentinel — the OneCLI gateway sees it on outbound requests and substitutes the real value from the vault. Do not put the real API key in this file.

If the group already has other MCP servers, merge into the existing `mcpServers` object — don't replace.

## Phase 5: Restart the agent's container

The host's hot-reload of `container.json` is not guaranteed for every change shape; restart cleanly:

```bash
docker stop nanoclaw-v2-<group-folder>-<id>
```

The host respawns on the next inbound message. The session DB persists across the restart.

## Phase 6: Verify

Inside the running container:

```bash
docker exec -it <container-name> bash
# inside:
mcp-remote --version
which cookie-string && which mark-login-suspect
```

From chat, ask the agent something that requires a saved-login domain (e.g. summarize a Bloomberg article URL where `/add-site-login` has captured cookies). The agent should:

1. Detect `bloomberg.com` in `/workspace/agent/browser-states/index.json`.
2. Run `cookie-string bloomberg.com` to get the cookie header.
3. Call `mcp__scrapfly__web_get_page` (or `web_scrape`) with the URL and cookies.
4. Return the article content.

If the agent gets a block response (PerimeterX page, "Press & Hold", etc.), it will run `mark-login-suspect bloomberg.com "<reason>"` and surface a "re-run /add-site-login" message rather than retrying.

## Cost notes

- Free tier: 1,000 credits/month.
- Anti-Scraping Protection (`asp: true`, default in the MCP) costs more than basic scrapes — typically 10–25 credits per request on tier-1 sites.
- Scrapfly responses include `result.cost.amount`. If you want telemetry, log that field.
- The `info_account` MCP tool returns current usage and remaining credits.

## Troubleshooting

- **`401 Unauthorized` from mcp.scrapfly.io**: Phase 3 wasn't done. Re-check `onecli agents secrets --id <id>` shows the Scrapfly secret, or set the agent's secret-mode to `all`.
- **Tool not in the agent's catalog**: confirm `mcp__scrapfly__*` is in `TOOL_ALLOWLIST` in `container/agent-runner/src/providers/claude.ts`. If you added Scrapfly after that file last shipped, the image needs a rebuild.
- **`mcp-remote: command not found`**: image is from before this skill landed. Rebuild with `./container/build.sh`.
- **Cookies not flowing through**: confirm the agent runs `cookie-string <domain>` (exit 0) and passes the output as the `cookies` argument to the Scrapfly tool. The MCP tool's parameter is named `cookies` (string, semicolon-separated).
