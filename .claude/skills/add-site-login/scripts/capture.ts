#!/usr/bin/env pnpm exec tsx
/**
 * add-site-login — capture a logged-in browser session for an agent group.
 *
 * Opens a real Chrome window, waits for the user to log in, then writes
 * Playwright storageState (cookies + localStorage) to
 * groups/<folder>/browser-states/<domain>[--<label>].json with mode 0600
 * and updates groups/<folder>/browser-states/index.json.
 *
 * Usage:
 *   pnpm exec tsx .claude/skills/add-site-login/scripts/capture.ts \
 *     --group <agent-group-id> --url <login-url> [--label <label>] [--domain <override>]
 */

import { chromium } from 'playwright';
import * as readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDb } from '../../../../src/db/connection.js';
import { getAgentGroup } from '../../../../src/db/agent-groups.js';

interface Args {
  group: string;
  url: string;
  label?: string;
  domain?: string;
}

interface IndexEntry {
  file: string;
  url: string;
  label?: string;
  savedAt: string;
}

type Index = Record<string, IndexEntry>;

const PROJECT_ROOT = process.env.NANOCLAW_ROOT || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'v2.db');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--group') {
      out.group = value;
      i++;
    } else if (flag === '--url') {
      out.url = value;
      i++;
    } else if (flag === '--label') {
      out.label = value;
      i++;
    } else if (flag === '--domain') {
      out.domain = value;
      i++;
    }
  }
  if (!out.group || !out.url) {
    console.error('Usage: capture.ts --group <id> --url <login-url> [--label <label>] [--domain <override>]');
    process.exit(2);
  }
  return out as Args;
}

/**
 * Pull a stable filename-safe domain key from a URL. Strips a leading
 * "www." but keeps other subdomains intact — different subdomains often
 * mean different login boundaries (e.g. accounts.google.com vs
 * mail.google.com), and we'd rather over-segment than load the wrong
 * cookies. Caller can override with --domain.
 */
function domainFromUrl(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host.replace(/^www\./, '');
}

const SAFE_LABEL = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

function safeLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  if (!SAFE_LABEL.test(label)) {
    console.error(`Invalid --label "${label}". Allowed: 1–32 chars, [A-Za-z0-9_-], must start alphanumeric.`);
    process.exit(2);
  }
  return label;
}

function readIndex(indexPath: string): Index {
  if (!fs.existsSync(indexPath)) return {};
  const raw = fs.readFileSync(indexPath, 'utf8');
  return JSON.parse(raw) as Index;
}

function writeIndex(indexPath: string, index: Index): void {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', { mode: 0o600 });
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, () => {
      rl.close();
      resolve();
    }),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const label = safeLabel(args.label);

  initDb(DB_PATH);
  const group = getAgentGroup(args.group);
  if (!group) {
    console.error(`Agent group not found: ${args.group}`);
    process.exit(1);
  }

  const domain = args.domain || domainFromUrl(args.url);
  const filename = label ? `${domain}--${label}.json` : `${domain}.json`;
  const indexKey = label ? `${domain}#${label}` : domain;

  const groupDir = path.join(PROJECT_ROOT, 'groups', group.folder);
  if (!fs.existsSync(groupDir)) {
    console.error(`Group folder missing: ${groupDir}`);
    process.exit(1);
  }
  const browserStatesDir = path.join(groupDir, 'browser-states');
  fs.mkdirSync(browserStatesDir, { recursive: true, mode: 0o700 });

  const outputPath = path.join(browserStatesDir, filename);
  const indexPath = path.join(browserStatesDir, 'index.json');

  console.log(`\n=== add-site-login ===`);
  console.log(`Agent group : ${group.name} (${group.id})`);
  console.log(`Login URL   : ${args.url}`);
  console.log(`Domain      : ${domain}${label ? `  [label: ${label}]` : ''}`);
  console.log(`Output      : ${path.relative(PROJECT_ROOT, outputPath)}\n`);

  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-login-'));

  let context;
  try {
    context = await chromium.launchPersistentContext(tempProfile, {
      executablePath: CHROME_PATH,
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (err) {
    console.error('Failed to launch Chrome.');
    console.error('  Check that Chrome is installed and CHROME_PATH (in .env or env) points to it.');
    console.error('  Current CHROME_PATH:', CHROME_PATH);
    console.error('  If this host has no display, see "Headless host fallback" in SKILL.md.');
    console.error('Underlying error:', err instanceof Error ? err.message : String(err));
    fs.rmSync(tempProfile, { recursive: true, force: true });
    process.exit(1);
  }

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(args.url, { waitUntil: 'domcontentloaded' }).catch((err) => {
      console.warn(
        `Initial navigation warning (the page may still be usable): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    console.log('Chrome is open. Log in to the site, complete any 2FA / captcha,');
    console.log('and once you can see your logged-in home page or dashboard,');
    console.log('come back here and press Enter.\n');

    await waitForEnter('Press Enter when fully logged in... ');

    console.log('\nCapturing session state...');
    await context.storageState({ path: outputPath });
    fs.chmodSync(outputPath, 0o600);

    const index = readIndex(indexPath);
    index[indexKey] = {
      file: filename,
      url: args.url,
      ...(label ? { label } : {}),
      savedAt: new Date().toISOString(),
    };
    writeIndex(indexPath, index);
  } finally {
    // Always tear down the browser context and temp profile, even if the
    // storageState write or index update threw. Otherwise a leftover Chrome
    // process holds the temp dir, and rerunning the script piles up zombies.
    await context.close().catch(() => {});
    fs.rmSync(tempProfile, { recursive: true, force: true });
  }

  console.log(`\n✓ Saved ${path.relative(PROJECT_ROOT, outputPath)} (mode 0600)`);
  console.log(`✓ Updated ${path.relative(PROJECT_ROOT, indexPath)}`);
  console.log(`\nThe agent in group "${group.name}" can now load this state via:`);
  console.log(`  agent-browser state load /workspace/agent/browser-states/${filename}`);
  console.log(`\nTreat this file like an SSH private key — it grants access to your`);
  console.log(`account on ${domain} until the cookies expire.`);
}

main().catch((err) => {
  console.error('capture failed:', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
