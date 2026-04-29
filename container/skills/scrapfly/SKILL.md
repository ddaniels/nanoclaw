---
name: scrapfly
description: Fetch pages from sites that block stock automation (Bloomberg, FT, WSJ, NYT, sites behind PerimeterX/Cloudflare/Akamai) using Scrapfly's hosted scraping API. Use whenever a target URL has a saved login captured by /add-site-login. Triggers on attempts to read paywalled / logged-in / fingerprint-protected content.
allowed-tools: Bash(cookie-string:*), Bash(mark-login-suspect:*), mcp__scrapfly__*
---

# Scrapfly — fetch pages from anti-bot-protected sites

`agent-browser` is the default browsing tool. It works for normal sites and
even for many logged-in sites where the operator has captured a session via
`/add-site-login`. It does **not** work for sites with tier-1 bot detection
(PerimeterX, Cloudflare Turnstile, Akamai Bot Manager) — even with valid
cookies. Bloomberg, FT, WSJ, NYT, and similar all fall in this category.

For those sites you use the **Scrapfly MCP tools** (the `mcp__scrapfly__*`
tools in your tool catalog). Scrapfly is a hosted API: they run real
browsers on residential infrastructure, so the bot-detection layer trusts
them. We pass the captured cookies through their `cookies` parameter so
the request lands as the user, authenticated.

## Decision rule (must follow)

**Before navigating to any external URL, check the saved-logins index:**

```bash
[ -f /workspace/agent/browser-states/index.json ] && \
  cat /workspace/agent/browser-states/index.json
```

The index maps domains to state files, e.g.:

```json
{
  "bloomberg.com": { "file": "bloomberg.com.json", "url": "...", "savedAt": "...", "suspect": false }
}
```

Take the target URL's hostname, strip leading `www.`, and check:

| Index match | Use |
|---|---|
| Domain is in index, **not** suspect | **Scrapfly MCP** (`web_get_page` or `web_scrape`), with cookies loaded via `cookie-string` |
| Domain is in index, **suspect: true** | Don't try. Surface to user (see "Suspect entries" below) |
| Domain is **not** in index | `agent-browser open <url>` (the normal flow) |

`agent-browser` is no longer the right tool for any saved-login domain.
The capture system exists specifically so Scrapfly has the cookies it needs.

## How to use the Scrapfly tools

### Quick fetch (most cases)

`web_get_page` is the simplest entry point — it has smart defaults
(JavaScript rendering, anti-bot bypass) and accepts cookies:

```
1. cookies=$(cookie-string bloomberg.com)
2. call mcp__scrapfly__web_get_page with:
     url: "https://www.bloomberg.com/news/articles/<id>"
     cookies: <value of $cookies>
```

The tool returns the rendered page content. Parse for the article body
(usually a `<article>`, `<main>`, or schema.org-tagged element).

### Full control (custom headers, POST, fine-grained options)

`web_scrape` accepts the same `cookies` parameter plus headers, method,
body, country selection, and `asp` (Anti-Scraping Protection) toggle.
Use it when:
- You need a specific country/IP region (`country: "us"`).
- The site needs custom headers beyond cookies (e.g. `Referer`).
- You're hitting a JSON API endpoint, not an HTML page.

```
mcp__scrapfly__web_scrape with:
  url: "...", cookies: $cookies, asp: true, render_js: true, country: "us"
```

`asp: true` is the critical flag for tier-1 anti-bot sites and is on by
default. It costs more credits per request but defeats PerimeterX-class
detection. Don't disable it for saved-login domains.

## cookie-string helper

Always use the `cookie-string` shell helper to fetch the cookie string.
Don't hand-format cookies from the storageState file — `cookie-string`
handles the JSON parsing, label disambiguation, and (critically) the
**suspect check**.

```bash
cookie-string <domain>           # cookie-string bloomberg.com
cookie-string <domain>#<label>   # cookie-string substack.com#work
```

Output: `name1=val1; name2=val2; ...` to stdout. Capture and pass to the
Scrapfly tool's `cookies` parameter.

**Exit codes:**
- `0` — cookies on stdout, ready to use
- `1` — no entry, or state file missing (no saved login for this domain)
- `2` — usage error
- `3` — entry is marked **suspect**; refuse to emit cookies

If `cookie-string` exits 3, do not retry. Surface to the user (see below).

## When Scrapfly returns a block / failure

Scrapfly is good but not infallible. The cookies might be stale, the user
might have logged out elsewhere, the account might be flagged server-side,
or the site might have a new defense Scrapfly hasn't caught up to. Signs of
a block in the response:

- HTTP status 403 or 429
- Title contains "Are you a robot", "Just a moment", "Press & Hold", "Verify you are human"
- Body contains "Block reference ID", "We've detected unusual activity"
- Scrapfly returns `result.success: false` or `result.status_code` 403

When this happens:

```bash
mark-login-suspect <domain> "<short reason>"
# e.g.
mark-login-suspect bloomberg.com "scrapfly returned PerimeterX block"
```

This sets `suspect: true` on the index entry. **Don't retry** — the cookies
won't get better. Surface to the user:

> "Your saved login for `<domain>` was rejected — Scrapfly couldn't get
> past the site's defenses. The session may be expired or flagged. Run
> `/add-site-login` from Claude Code to capture a fresh login, then try
> again."

The user re-running `/add-site-login` overwrites the entry and clears the
suspect flag automatically.

## Suspect entries

If `cookie-string` exits 3 (or you see `"suspect": true` in the index entry
yourself), the cookies are known-bad. Don't call Scrapfly. Tell the user:

> "I have a saved login for `<domain>` but it's marked as expired/burned.
> Re-run `/add-site-login` from Claude Code to refresh it."

## Multi-account labels

Index keys may be `<domain>#<label>` for users with multiple accounts on
the same site (e.g. `substack.com#work`). The state file is
`<domain>--<label>.json`. `cookie-string substack.com#work` handles both
and emits the right cookies. If the user has multiple accounts and which
one matters isn't obvious from context, ask before guessing.

## Cost awareness

Scrapfly bills per request. With `asp: true` engaged for a tier-1 site:
roughly 10–25 credits per request. Don't loop fetches — get the page once,
extract what you need, move on. Avoid parallel fetches of the same article.
The Scrapfly response includes `result.cost` if you want to log usage.

## What NOT to do

- Don't use `agent-browser open` for any domain in the saved-logins index.
  It will get blocked and the wasted attempt may flag the session
  server-side.
- Don't manually format cookies from the storageState JSON. Use
  `cookie-string`.
- Don't ignore a `suspect: true` entry. The flag exists because someone
  (you, in a prior turn, or another agent session) hit a real block.
- Don't retry after `mark-login-suspect`. The session is bad until the
  user refreshes it.
