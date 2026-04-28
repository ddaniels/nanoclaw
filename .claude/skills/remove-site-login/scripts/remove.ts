#!/usr/bin/env pnpm exec tsx
/**
 * remove-site-login — delete a saved logged-in browser session for an agent group.
 *
 * Removes groups/<folder>/browser-states/<domain>[--<label>].json and the
 * matching entry from index.json.
 *
 * Usage:
 *   pnpm exec tsx .claude/skills/remove-site-login/scripts/remove.ts \
 *     --group <agent-group-id> --domain <domain> [--label <label>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { initDb } from '../../../../src/db/connection.js';
import { getAgentGroup } from '../../../../src/db/agent-groups.js';

interface IndexEntry {
  file: string;
  url: string;
  label?: string;
  savedAt: string;
}

type Index = Record<string, IndexEntry>;

const PROJECT_ROOT = process.env.NANOCLAW_ROOT || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'v2.db');

const SAFE_LABEL = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const SAFE_DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

interface Args {
  group: string;
  domain: string;
  label?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--group') {
      out.group = value;
      i++;
    } else if (flag === '--domain') {
      out.domain = value;
      i++;
    } else if (flag === '--label') {
      out.label = value;
      i++;
    }
  }
  if (!out.group || !out.domain) {
    console.error('Usage: remove.ts --group <id> --domain <domain> [--label <label>]');
    process.exit(2);
  }
  if (!SAFE_DOMAIN.test(out.domain)) {
    console.error(`Invalid --domain "${out.domain}".`);
    process.exit(2);
  }
  if (out.label !== undefined && !SAFE_LABEL.test(out.label)) {
    console.error(`Invalid --label "${out.label}". Allowed: 1–32 chars, [A-Za-z0-9_-], must start alphanumeric.`);
    process.exit(2);
  }
  return out as Args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  initDb(DB_PATH);
  const group = getAgentGroup(args.group);
  if (!group) {
    console.error(`Agent group not found: ${args.group}`);
    process.exit(1);
  }

  const browserStatesDir = path.join(PROJECT_ROOT, 'groups', group.folder, 'browser-states');
  const indexPath = path.join(browserStatesDir, 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.error(`No browser-states/index.json for group "${group.name}". Nothing to remove.`);
    process.exit(1);
  }

  const indexKey = args.label ? `${args.domain}#${args.label}` : args.domain;
  const filename = args.label ? `${args.domain}--${args.label}.json` : `${args.domain}.json`;

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Index;
  if (!(indexKey in index)) {
    console.error(`No saved login for "${indexKey}" in group "${group.name}".`);
    console.error(`Run /list-site-logins to see what's saved.`);
    process.exit(1);
  }

  // Trust the index for the actual filename (it may differ from our
  // computed default if a future version of /add-site-login changes the
  // naming convention). Fall back to the computed name only if missing.
  const actualFile = index[indexKey].file || filename;
  const filePath = path.join(browserStatesDir, actualFile);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`✓ Removed ${path.relative(PROJECT_ROOT, filePath)}`);
  } else {
    console.warn(`File ${path.relative(PROJECT_ROOT, filePath)} not found, removing index entry anyway.`);
  }

  delete index[indexKey];
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', { mode: 0o600 });
  console.log(`✓ Updated ${path.relative(PROJECT_ROOT, indexPath)}`);

  const remaining = Object.keys(index).length;
  console.log(`\n${remaining} saved login(s) remain for group "${group.name}".`);
}

main();
