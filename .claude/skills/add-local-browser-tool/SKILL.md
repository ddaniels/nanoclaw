---
name: add-local-browser-tool
description: Add MCP tools that drive a host-side Chrome over CDP, so the container agent inherits the operator's logged-in cookies. Bypasses paywalls and bot-detection (Bloomberg, NYT, etc.) by using the operator's real browser fingerprint. macOS only.
---

# Add Local Browser MCP Tool

This skill installs a launchd-managed Chrome on the host with remote debugging
enabled, then verifies the container can reach it. The MCP tool itself
(`local_browser_fetch_page`, `local_browser_screenshot`) ships in-tree on this
fork — no code changes needed at install time.

**macOS only.** Requires Google Chrome installed at the standard location.

## How it works

The launchd plist runs a dedicated Chrome instance with:
- `--remote-debugging-port=9222` on `127.0.0.1` only (no LAN exposure)
- `--remote-allow-origins=*` (lets non-DevTools clients connect)
- `--user-data-dir=$HOME/.nanoclaw-browser-profile` (separate profile that
  persists cookies across Chrome restarts)

The container's Node helper resolves `host.docker.internal` to its IP and
connects to `http://<ip>:9222`. Chrome's CDP rejects Host headers that
aren't an IP or "localhost", so the IP-form is what makes the loopback bind
reachable from inside Docker.

## Side effects

The operator should know what they're signing up for:

| Effect | Detail |
|---|---|
| Two Chrome dock icons | Visually identical. Pin one, ignore the other. Drop the dedicated one on a background Space. |
| Cmd-Q is sticky | `KeepAlive=true` respawns the window seconds later. To stop: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.browser.plist`. |
| ~200–400MB always-on RAM | Idle Chrome process. Up to ~1GB with several tabs open. |
| No extensions in dedicated profile | Fresh profile; agents don't have to fight ad blockers or password managers. Actually desirable. |
| Default browser unaffected | `--no-default-browser-check` prevents prompting. Link clicks from other apps still go to the operator's main Chrome. |

## Phase 1: Pre-flight

### Check platform

If not on macOS, stop and tell the user:

> This skill is macOS only. Linux support (systemd user unit) is deferred.

### Check Chrome is installed

```bash
test -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" && echo ok
```

If missing, tell the user to install Chrome from https://www.google.com/chrome/.

### Check if already installed

```bash
test -f ~/Library/LaunchAgents/com.nanoclaw.browser.plist && echo "already installed"
```

If already installed, skip to Phase 3 (Verify).

## Phase 2: Install the launchd job

### Render the plist template

The template lives at `${CLAUDE_SKILL_DIR}/files/com.nanoclaw.browser.plist.template`
with `{HOME}` as a placeholder. Substitute the operator's actual `$HOME`:

```bash
sed "s|{HOME}|$HOME|g" "${CLAUDE_SKILL_DIR}/files/com.nanoclaw.browser.plist.template" \
  > ~/Library/LaunchAgents/com.nanoclaw.browser.plist
```

### Load it

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.browser.plist
```

A new Chrome window opens, pointed at `~/.nanoclaw-browser-profile`. The
window has no extensions, no Google account, and a fresh "New Tab" page.

### Pause for human login

Tell the user:

> A dedicated Chrome window just opened with an empty profile. Before continuing:
>
> 1. Bring that Chrome window to the front (it's the second Chrome dock icon).
> 2. Navigate to any sites you want the agent to access (Bloomberg, NYT, etc.) and log in by hand.
> 3. If a site has a Press-and-Hold or CAPTCHA challenge, solve it once.
>
> Cookies persist in `~/.nanoclaw-browser-profile`. You only need to log in once per site (until the site expires the session, typically weeks).
>
> When you're done, type "continue" and I'll verify the connection and rebuild the container.

Wait for confirmation before proceeding.

## Phase 3: Verify host-side reachability

```bash
curl -s http://127.0.0.1:9222/json/version | python3 -m json.tool | head -5
```

Should print a JSON blob starting with `"Browser": "Chrome/..."`. If not:
- Check `/tmp/nanoclaw-browser.err.log` for Chrome startup errors
- Check `ps -ax -o args= | grep remote-debugging-port` to confirm Chrome is running with the right flags

## Phase 4: Rebuild the container

The MCP tool source already lives in-tree (this is a fork-only feature). The
container image just needs the new `puppeteer-core` dependency, which was
added to `container/agent-runner/package.json`:

```bash
./container/build.sh
```

### Restart the service

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 5: Smoke test

Tell the user:

> Send the agent a message like:
>
> > Use local_browser_fetch_page on https://www.bloomberg.com/news/articles/... and tell me the article's first paragraph.
>
> Expect: word count above ~500 in the tool result, and a real summary (not "I hit a paywall"). If you see paywall HTML, the dedicated Chrome isn't logged into Bloomberg yet — bring its window forward, log in, and try again.

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i local-browser
```

Look for the helper subprocess being spawned and returning JSON.

## Phase 6: Quality of life — keep the window out of the way

Once the smoke test passes, the dedicated Chrome window can be parked on its
own Space so it doesn't pop up on whichever Desktop you're currently using
when the agent opens a new tab.

Tell the user:

> The dedicated Chrome window is going to stay running 24/7 — let's get it
> out of your face.
>
> **Recommended: pin it to its own Space.**
>
> 1. Open Mission Control (F3, or three-finger swipe up).
> 2. Click the `+` at the top-right to add a new Desktop.
> 3. Drag the NanoClaw Chrome window onto that new Desktop.
> 4. Right-click the NanoClaw Chrome dock icon → **Options → Assign To → Desktop on Display 1** (the new one). Now every window and new tab from that Chrome instance stays on that Desktop.
>
> **Alternative: minimize.** Cmd+M (or yellow button) the window. New tabs the agent opens don't un-minimize it. Caveat: macOS may throttle rendering of minimized windows, which could slow lazy-loaded paywall scripts on some sites — hasn't been a problem so far, but flag it if you see odd behavior.
>
> Avoid Cmd+H (Hide) — same throttling concern *and* you lose easy access to the window for re-logins.

## Troubleshooting

### Tool returns "ECONNREFUSED" or "dns lookup failed"

Chrome isn't running, or `host.docker.internal` doesn't resolve from inside the container.

- Confirm the plist is loaded: `launchctl list | grep com.nanoclaw.browser`
- Confirm Chrome on host: `curl http://127.0.0.1:9222/json/version`
- On Docker Desktop, `host.docker.internal` should resolve automatically. On Linux, the host adds `--add-host=host.docker.internal:host-gateway` via `hostGatewayArgs()` in `src/container-runtime.ts`.

### Tool hangs at "ws connecting"

The `--remote-allow-origins=*` flag is missing from the plist. Re-render:

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.browser.plist
sed "s|{HOME}|$HOME|g" "${CLAUDE_SKILL_DIR}/files/com.nanoclaw.browser.plist.template" \
  > ~/Library/LaunchAgents/com.nanoclaw.browser.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.browser.plist
```

### Tool returns "403 Host header" or similar

The IP-resolve step in the helper didn't run. Check that
`container/agent-runner/src/local-browser-helper.mjs` calls
`dns.lookup(host)` before constructing the CDP URL.

### Tool returns short / empty body

A tab in the dedicated Chrome window is stuck on a Cloudflare or PerimeterX
challenge. Bring the window forward, dismiss the challenge once (it's
sticky for the profile), and retry.

### Bun + CDP incompatibility

The MCP tool spawns a Node subprocess (`node /app/src/local-browser-helper.mjs ...`)
because Bun's WebSocket client doesn't complete CDP's upgrade handshake.
Don't try to inline the puppeteer calls into the Bun-side TypeScript file.

### Why puppeteer-core, not playwright-core

Playwright's `connectOverCDP` calls `Browser.setDownloadBehavior` at connect
time, which user-launched Chrome rejects with "Browser context management
is not supported." Puppeteer-core is built for connecting to existing
Chrome and doesn't issue browser-level commands on connect.

## Removal

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.browser.plist
rm ~/Library/LaunchAgents/com.nanoclaw.browser.plist
```

**Do not delete `~/.nanoclaw-browser-profile` without confirming with the
operator** — it holds the logged-in cookies they spent time setting up.

The MCP tool source stays in-tree (it's part of `prod`); removing it
requires a code revert, not a skill action.
