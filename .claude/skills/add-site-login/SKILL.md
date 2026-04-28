---
name: add-site-login
description: Capture a logged-in browser session for a website (Bloomberg, Substack, paywalled news, internal apps) so agents can browse it authenticated. Opens a real Chrome window for the user to log in once; saves cookies + localStorage to the agent group's workspace. Triggers on "add site login", "save login", "log in to <site> for the agent", "let the agent read Bloomberg".
---

# Capture a logged-in browser session for an agent group

The container's `agent-browser` CLI already supports `state save` / `state load`
(Playwright `storageState` format) — see `container/skills/agent-browser`. The
missing piece is a host-side way to *produce* that state file for sites the
agent can't log into headlessly (2FA, captchas, SSO, fingerprint detection).

This skill opens a real Chrome window on the host, lets the user log in once,
and saves the resulting cookies + localStorage into the agent group's
persistent workspace at `groups/<folder>/browser-states/<domain>.json`. The
folder is mounted into the container at `/workspace/agent/browser-states/` so
every future session for that agent group can load the state.

## When to use

- User asks the agent to read a paywalled article (Bloomberg, FT, NYT, WSJ).
- User wants the agent to read or summarize Substack posts they're subscribed
  to.
- User wants the agent to interact with any web app they're logged into
  (internal dashboards, GitHub Enterprise, Notion, etc.).

## Prerequisites

1. The host has Chrome installed (default macOS path, or `CHROME_PATH` in
   `.env`). The same path used by `/x-integration` works.
2. Playwright is installed in the project. If not:
   ```bash
   pnpm ls playwright || pnpm install -D playwright
   ```
3. The host has a graphical display. Headless servers cannot run this — see
   "Headless host fallback" below.

## Flow

When the user invokes this skill:

1. **Identify the agent group.** If only one agent group exists, use it.
   Otherwise list groups and ask which one (`pnpm exec tsx -e "import { getAllAgentGroups } from './src/db/agent-groups.js'; console.log(getAllAgentGroups())"`
   or read from `data/v2.db`).

2. **Get the login URL.** Ask the user for the URL of the site's login page
   (e.g. `https://www.bloomberg.com/account/signin`). If they give a generic
   URL like `bloomberg.com`, ask for the explicit login page.

3. **Optional label.** If the user has multiple accounts for the same site
   (e.g. personal + work Substack), ask for a short label (`personal`,
   `work`). The label becomes part of the filename: `<domain>--<label>.json`.

4. **Run the capture script.**
   ```bash
   pnpm exec tsx .claude/skills/add-site-login/scripts/capture.ts \
     --group <agent-group-id> \
     --url <login-url> \
     [--label <label>] \
     [--domain <override>]
   ```
   The script:
   - Opens a Chrome window (real fingerprint, persistent profile in a temp
     dir for the duration of this capture).
   - Navigates to the login URL.
   - Prints "Press Enter when you're fully logged in..." and waits on stdin.
   - On Enter: calls `context.storageState({ path: ... })`, writes to
     `groups/<folder>/browser-states/<domain>[--<label>].json` with mode
     `0600`, updates `groups/<folder>/browser-states/index.json`, and exits.

5. **Confirm.** Tell the user the file was saved and what domain it covers.
   Tell them: *"Cookies grant access to your account — treat this file like
   an SSH private key. It's in `groups/<folder>/browser-states/`, mode 0600,
   not committed to git."*

## What the agent does next

The container-side `agent-browser` skill is updated to check
`/workspace/agent/browser-states/index.json` before navigating. If the target
URL's domain matches an entry, the agent runs `agent-browser state load
/workspace/agent/browser-states/<file>` first, then `agent-browser open`.

If the agent later hits a paywall or login wall on a domain that *does* have
a saved state, the cookies are stale. The agent should surface that to the
user with: *"Your saved login for `<domain>` looks expired — run
`/add-site-login` to refresh."* It should not try to log in headlessly.

## Refreshing an expired login

Run this skill again with the same URL (and same label if used). The capture
script overwrites the existing file and updates the `savedAt` timestamp in
the index.

## Removing a saved login

```bash
rm groups/<folder>/browser-states/<domain>.json
# Then edit groups/<folder>/browser-states/index.json to drop the entry.
```

(A `/remove-site-login` skill could be added later if this becomes common.)

## Headless host fallback

If the host has no display (cloud VM, headless Linux server), the script
fails to launch the browser. In that case:

1. Run the capture flow on a local machine that *does* have a display, with
   a checked-out copy of the repo. The script outputs a portable JSON file.
2. Copy the resulting `groups/<folder>/browser-states/<domain>.json` and
   the updated `index.json` entry to the production host's matching
   `groups/<folder>/browser-states/` directory.
3. Set mode 0600.

## Security notes

- Files are saved with mode `0600` (user-read/write only).
- `groups/*` is already in `.gitignore`, so accidental commits are blocked.
- The file contains live session cookies for the site. Anyone with read
  access to the user's home directory has access to the account until the
  cookies expire. Same threat model as `.env`, SSH keys, agent-runner DBs.
- No credentials (username/password) are stored — only the post-login
  session state.

## File layout

```
groups/<folder>/browser-states/
├── index.json                    # { "<domain>": { file, label?, savedAt, url, notes? } }
├── bloomberg.com.json            # Playwright storageState
├── substack.com.json
└── substack.com--work.json       # multi-account
```

Inside the container, this is visible at `/workspace/agent/browser-states/`.
