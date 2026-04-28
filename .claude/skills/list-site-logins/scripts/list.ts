#!/usr/bin/env pnpm exec tsx
/**
 * list-site-logins — print saved logged-in browser sessions for an agent group.
 *
 * Reads groups/<folder>/browser-states/index.json (written by /add-site-login)
 * and prints a table: domain | label | savedAt | file. Exits 0 even if the
 * index is empty or missing — "nothing saved" is a normal state, not an error.
 *
 * Usage:
 *   pnpm exec tsx .claude/skills/list-site-logins/scripts/list.ts --group <agent-group-id>
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

function parseArgs(argv: string[]): { group: string } {
  let group: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--group') {
      group = argv[i + 1];
      i++;
    }
  }
  if (!group) {
    console.error('Usage: list.ts --group <agent-group-id>');
    process.exit(2);
  }
  return { group };
}

function main(): void {
  const { group: groupId } = parseArgs(process.argv.slice(2));

  initDb(DB_PATH);
  const group = getAgentGroup(groupId);
  if (!group) {
    console.error(`Agent group not found: ${groupId}`);
    process.exit(1);
  }

  const browserStatesDir = path.join(PROJECT_ROOT, 'groups', group.folder, 'browser-states');
  const indexPath = path.join(browserStatesDir, 'index.json');

  console.log(`\nAgent group: ${group.name} (${group.id})`);
  console.log(`Directory  : ${path.relative(PROJECT_ROOT, browserStatesDir)}\n`);

  if (!fs.existsSync(indexPath)) {
    console.log('No saved logins. Run /add-site-login to capture one.');
    return;
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Index;
  const entries = Object.entries(index);
  if (entries.length === 0) {
    console.log('No saved logins. Run /add-site-login to capture one.');
    return;
  }

  // Width-padded table, sorted by domain then label.
  entries.sort(([a], [b]) => a.localeCompare(b));
  const rows = entries.map(([key, e]) => {
    const [domain] = key.split('#');
    return {
      domain,
      label: e.label || '',
      savedAt: e.savedAt,
      file: e.file,
    };
  });
  const widths = {
    domain: Math.max(6, ...rows.map((r) => r.domain.length)),
    label: Math.max(5, ...rows.map((r) => r.label.length)),
    savedAt: Math.max(20, ...rows.map((r) => r.savedAt.length)),
  };

  const header =
    'DOMAIN'.padEnd(widths.domain) +
    '  ' +
    'LABEL'.padEnd(widths.label) +
    '  ' +
    'SAVED AT'.padEnd(widths.savedAt) +
    '  FILE';
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      r.domain.padEnd(widths.domain) +
        '  ' +
        r.label.padEnd(widths.label) +
        '  ' +
        r.savedAt.padEnd(widths.savedAt) +
        '  ' +
        r.file,
    );
  }
  console.log(`\n${entries.length} saved login(s).`);
}

main();
