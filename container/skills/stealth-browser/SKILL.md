---
name: stealth-browser
description: Browse logged-in or fingerprint-protected sites (Bloomberg, FT, NYT, WSJ, internal apps with anti-bot defenses) when stock automation gets blocked. Sidecar to agent-browser. Use whenever the target domain has a saved login in /workspace/agent/browser-states/.
allowed-tools: Bash(stealth-browser:*)
---

# stealth-browser — Playwright + rebrowser-patches sidecar

`stealth-browser` is a small Node CLI alongside `agent-browser`. It exists
because some sites (Bloomberg, FT, NYT, WSJ, paywalled news, internal apps
behind PerimeterX/Cloudflare/Akamai) detect and block stock browser
automation — even with valid auth cookies — based on fingerprint signals
that automation libraries leak by default.

`stealth-browser` is built on `rebrowser-playwright` (a Playwright fork
with rebrowser-patches baked in) which removes those leaks at the
CDP/Node API layer.

## When to use it (decision rule)

**Always use `stealth-browser` when the target URL's domain has an entry
in `/workspace/agent/browser-states/index.json`. Otherwise use
`agent-browser`.**

Concretely, before navigating to any external URL:

```bash
[ -f /workspace/agent/browser-states/index.json ] && \
  cat /workspace/agent/browser-states/index.json
```

If `<domain>` (registrable domain, with leading `www.` stripped) is a key
in that JSON, the entry's `file` field gives the storageState path. Run
`stealth-browser` with `--state /workspace/agent/browser-states/<file>`.

If no entry matches, use `agent-browser` as normal.

## Command surface

`stealth-browser` is single-shot per invocation: launch → action → close.
Cookies travel via the storageState JSON.

```bash
# Navigate. Returns { ok, status, url, title }.
stealth-browser open <url> [--state <path>] [--timeout <ms>]

# Navigate + extract plain-text content. Returns { ok, status, url, title, text }.
# --selector limits to a CSS selector (first match only). Default: <body>.
stealth-browser extract-text <url> [--state <path>] [--selector <css>] [--timeout <ms>]

# Accessibility tree, similar to agent-browser snapshot but simpler.
stealth-browser snapshot <url> [--state <path>] [--no-interesting] [--timeout <ms>]

# Save a PNG. Useful for debugging block pages.
stealth-browser screenshot <url> --output <png-path> [--state <path>] [--full-page] [--timeout <ms>]

# Refresh the storageState file after a session-cookie rotation.
stealth-browser state-save <url> --output <json-path> [--state <path>] [--timeout <ms>]
```

## Typical use: read a Bloomberg article

```bash
# 1. Confirm there's a saved login for bloomberg.com.
cat /workspace/agent/browser-states/index.json
# → { "bloomberg.com": { "file": "bloomberg.com.json", ... } }

# 2. Read the article.
stealth-browser extract-text \
  https://www.bloomberg.com/news/articles/<id> \
  --state /workspace/agent/browser-states/bloomberg.com.json
```

Output is a single JSON line on stdout. Parse the `text` field for the
article body.

## When `stealth-browser` fails

If the response is a PerimeterX challenge, Cloudflare interstitial, or
similar block page (look for "Press & Hold", "Verify you are human",
suspicious title like "Just a moment..."), one of:

1. **The captured cookies are stale.** Surface to the user:
   > "Your saved login for `<domain>` looks expired — run `/add-site-login`
   > from Claude Code to refresh it."

2. **The site's bot detection is beyond what this tool covers.** Some sites
   (notably Bloomberg, the Wall Street Journal, the New York Times) use
   PerimeterX or comparable tier-1 bot detection that fingerprints the
   browser and TLS stack at a level that `rebrowser-playwright` +
   `puppeteer-extra-plugin-stealth` cannot fully hide. Even valid cookies
   don't help if the *browser itself* is flagged before the cookie check.
   Don't retry. Tell the user:
   > "I have your saved login for `<domain>`, but their bot detection is
   > blocking the agent's browser. This is a known limitation — the site
   > would need a bypass service or a different content path."

**Do not retry headlessly.** Either failure mode is permanent until the
user takes action.

For debugging, capture a screenshot:

```bash
stealth-browser screenshot \
  https://<failing-url> \
  --output /tmp/block.png \
  --state /workspace/agent/browser-states/<domain>.json
```

## What's different from agent-browser

- `agent-browser` is the default — fast, has 70+ commands, good for normal
  browsing.
- `stealth-browser` has ~5 commands, only for blocked sites. It is
  noticeably slower per-call (cold launch + storageState load every time).
- They both read the same `/workspace/agent/browser-states/<domain>.json`
  files captured by `/add-site-login` on the host.
- They both honor `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (set in the
  container Dockerfile).

## Multi-account labels

If the user has multiple accounts on the same domain, the storageState
file is `<domain>--<label>.json` and the `index.json` key is
`<domain>#<label>`. Pass the right path to `--state`. Same convention as
agent-browser's `state load`.
