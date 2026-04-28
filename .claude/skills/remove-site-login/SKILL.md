---
name: remove-site-login
description: Remove a saved logged-in browser session from an agent group. Deletes the storageState file and updates the index. Triggers on "remove site login", "delete saved login", "log out the agent from <site>", "drop browser state".
---

# Remove a saved logged-in browser session for an agent group

Companion to `/add-site-login`. Deletes the storageState file at
`groups/<folder>/browser-states/<domain>[--<label>].json` and removes its
entry from `index.json`.

## Flow

1. **Identify the agent group.** If only one agent group exists, use it.
   Otherwise list groups and ask which one.

2. **Identify the entry to remove.** Run `/list-site-logins` first if the
   user isn't sure which entry to drop. Each entry is keyed by `<domain>` or
   `<domain>#<label>` for multi-account.

3. **Run the remove script.**
   ```bash
   pnpm exec tsx .claude/skills/remove-site-login/scripts/remove.ts \
     --group <agent-group-id> \
     --domain <domain> \
     [--label <label>]
   ```

   The script:
   - Deletes the storageState JSON file.
   - Removes the matching entry from `index.json`.
   - If `index.json` becomes empty, leaves it as `{}` (so the directory
     stays in a clean state for the next `/add-site-login`).

4. **Confirm.** Tell the user what was removed.

## When to use

- User no longer wants the agent to have access to a site.
- User changed their password and wants to drop the now-stale state.
- Before re-running `/add-site-login` for the same site under a new
  account (alternative: just re-run `/add-site-login`, which overwrites).

## Notes

- This does *not* log the user out of the site in their own browser — it
  only removes the captured cookies that the agent uses.
- It also does not invalidate the session on the server side. If the
  cookies were stolen before deletion, the attacker still has them until
  the site itself rotates or expires the session.
