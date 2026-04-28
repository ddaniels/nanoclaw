---
name: list-site-logins
description: List the saved logged-in browser sessions for an agent group. Shows domain, label (if any), source URL, and savedAt timestamp. Triggers on "list site logins", "list saved logins", "what sites is the agent logged into", "show browser states".
---

# List saved logged-in browser sessions for an agent group

Companion to `/add-site-login`. Reads
`groups/<folder>/browser-states/index.json` for the chosen agent group and
prints a table.

## Flow

1. **Identify the agent group.** If only one agent group exists, use it.
   Otherwise list groups (read from `data/v2.db` via `getAllAgentGroups`) and
   ask which one.

2. **Run the list script.**
   ```bash
   pnpm exec tsx .claude/skills/list-site-logins/scripts/list.ts \
     --group <agent-group-id>
   ```

The script prints one row per saved login with the domain, optional label,
the URL the user logged in at, the saved-at timestamp, and the relative
file path. If the index is missing or empty, it says so.

## When to use

- User asks "what sites am I logged into for the agent?"
- Before running `/add-site-login` to check whether a login already exists.
- Before running `/remove-site-login` to confirm the entry to remove.
