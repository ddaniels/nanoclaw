---
name: agent-browser
description: Browse the web for any task — research topics, read articles, interact with web apps, fill forms, take screenshots, extract data, and test web pages. Use whenever a browser would be useful, not just when the user explicitly asks.
allowed-tools: Bash(agent-browser:*)
---

# Browser Automation with agent-browser

## Quick start

```bash
agent-browser open <url>        # Navigate to page
agent-browser snapshot -i       # Get interactive elements with refs
agent-browser click @e1         # Click element by ref
agent-browser fill @e2 "text"   # Fill input by ref
agent-browser close             # Close browser
```

## Core workflow

1. Navigate: `agent-browser open <url>`
2. Snapshot: `agent-browser snapshot -i` (returns elements with refs like `@e1`, `@e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands

### Navigation

```bash
agent-browser open <url>      # Navigate to URL
agent-browser back            # Go back
agent-browser forward         # Go forward
agent-browser reload          # Reload page
agent-browser close           # Close browser
```

### Snapshot (page analysis)

```bash
agent-browser snapshot            # Full accessibility tree
agent-browser snapshot -i         # Interactive elements only (recommended)
agent-browser snapshot -c         # Compact output
agent-browser snapshot -d 3       # Limit depth to 3
agent-browser snapshot -s "#main" # Scope to CSS selector
```

### Interactions (use @refs from snapshot)

```bash
agent-browser click @e1           # Click
agent-browser dblclick @e1        # Double-click
agent-browser fill @e2 "text"     # Clear and type
agent-browser type @e2 "text"     # Type without clearing
agent-browser press Enter         # Press key
agent-browser hover @e1           # Hover
agent-browser check @e1           # Check checkbox
agent-browser uncheck @e1         # Uncheck checkbox
agent-browser select @e1 "value"  # Select dropdown option
agent-browser scroll down 500     # Scroll page
agent-browser upload @e1 file.pdf # Upload files
```

### Get information

```bash
agent-browser get text @e1        # Get element text
agent-browser get html @e1        # Get innerHTML
agent-browser get value @e1       # Get input value
agent-browser get attr @e1 href   # Get attribute
agent-browser get title           # Get page title
agent-browser get url             # Get current URL
agent-browser get count ".item"   # Count matching elements
```

### Screenshots & PDF

```bash
agent-browser screenshot          # Save to temp directory
agent-browser screenshot path.png # Save to specific path
agent-browser screenshot --full   # Full page
agent-browser pdf output.pdf      # Save as PDF
```

### Wait

```bash
agent-browser wait @e1                     # Wait for element
agent-browser wait 2000                    # Wait milliseconds
agent-browser wait --text "Success"        # Wait for text
agent-browser wait --url "**/dashboard"    # Wait for URL pattern
agent-browser wait --load networkidle      # Wait for network idle
```

### Semantic locators (alternative to refs)

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search" type "query"
```

### Authentication with saved state

```bash
# Login once
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Later: load saved state
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

### Logged-in sites (Bloomberg, Substack, paywalls, internal apps)

Sites that require login, 2FA, captchas, or have aggressive bot detection
can't be logged into headlessly from inside the container. Instead, the user
captures a real-browser session on the host with `/add-site-login`. The saved
cookies live at `/workspace/agent/browser-states/<domain>.json`.

**Before navigating to any external URL, check the index:**

```bash
[ -f /workspace/agent/browser-states/index.json ] && \
  cat /workspace/agent/browser-states/index.json
```

The index maps domains to state files, e.g.:

```json
{
  "bloomberg.com": { "file": "bloomberg.com.json", "url": "...", "savedAt": "..." },
  "substack.com":  { "file": "substack.com.json",  "url": "...", "savedAt": "..." }
}
```

**If the target URL's hostname (stripped of leading `www.`) matches an entry
in the index, switch to the `stealth-browser` tool — not `agent-browser`.**

`stealth-browser` is a sidecar built on `rebrowser-playwright` that adds
fingerprint evasions for sites that block stock automation (PerimeterX,
Cloudflare, Akamai). See `container/skills/stealth-browser/SKILL.md` for the
full command surface. Typical article-reading flow:

```bash
stealth-browser extract-text https://www.bloomberg.com/news/articles/... \
  --state /workspace/agent/browser-states/bloomberg.com.json
```

Subdomains share cookies with the registrable domain, so an entry for
`bloomberg.com` covers `www.bloomberg.com`.

**If `stealth-browser` returns what looks like a block page** (PerimeterX
"Press & Hold", Cloudflare interstitial, suspicious "Just a moment..." title),
the cookies are stale or the site has tightened detection. Do **not** retry
headlessly — surface this to the user:

> "Your saved login for `<domain>` looks expired — run `/add-site-login` to
> refresh it."

**If a user asks the agent to read a paywalled or logged-in site that has no
saved state**, point them at the skill rather than failing silently:

> "I don't have a saved login for `<domain>`. Run `/add-site-login` from
> Claude Code on your laptop to capture one."

Multi-account: index keys may be `<domain>#<label>` (e.g. `substack.com#work`)
for users with multiple accounts on the same domain. The corresponding state
file is `<domain>--<label>.json`. Pick by label if context makes it obvious;
otherwise ask.

**`agent-browser state load` is still available** but should only be used for
saved logins on domains that *aren't* in the index above (e.g. a one-off
manual capture you make in-session). For anything captured via
`/add-site-login`, prefer `stealth-browser`.

### Cookies & Storage

```bash
agent-browser cookies                     # Get all cookies
agent-browser cookies set name value      # Set cookie
agent-browser cookies clear               # Clear cookies
agent-browser storage local               # Get localStorage
agent-browser storage local set k v       # Set value
```

### JavaScript

```bash
agent-browser eval "document.title"   # Run JavaScript
```

## Example: Form submission

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output shows: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Example: Data extraction

```bash
agent-browser open https://example.com/products
agent-browser snapshot -i
agent-browser get text @e1  # Get product title
agent-browser get attr @e2 href  # Get link URL
agent-browser screenshot products.png
```
