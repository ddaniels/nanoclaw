#!/usr/bin/env node
import minimist from 'minimist';
import * as openCmd from './commands/open.js';
import * as extractTextCmd from './commands/extract-text.js';
import * as snapshotCmd from './commands/snapshot.js';
import * as screenshotCmd from './commands/screenshot.js';
import * as stateSaveCmd from './commands/state-save.js';

const USAGE = `\
stealth-browser — Playwright-driven browser with rebrowser-patches stealth.

Usage:
  stealth-browser open <url> [--state <path>] [--timeout <ms>]
  stealth-browser extract-text <url> [--state <path>] [--selector <css>] [--timeout <ms>]
  stealth-browser snapshot <url> [--state <path>] [--no-interesting] [--timeout <ms>]
  stealth-browser screenshot <url> --output <png> [--state <path>] [--full-page] [--timeout <ms>]
  stealth-browser state-save <url> --output <json> [--state <path>] [--timeout <ms>]

Notes:
  - Cookies live in the storageState JSON at --state (Playwright format,
    same files /add-site-login produces).
  - Each invocation is single-shot: launch → action → close.
  - The browser binary is taken from PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
`;

interface RawArgs {
  _: string[];
  state?: string;
  selector?: string;
  output?: string;
  timeout?: number;
  'full-page'?: boolean;
  interesting?: boolean;
  version?: boolean;
  help?: boolean;
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: ['state', 'selector', 'output'],
    boolean: ['full-page', 'interesting', 'version', 'help'],
    default: { interesting: true },
    alias: { h: 'help', v: 'version' },
  }) as RawArgs;

  if (argv.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (argv.version) {
    // Read package.json relative to dist/index.js (../package.json from dist).
    const pkg = await import('../package.json', { with: { type: 'json' } }).then(
      (m) => m.default as { version: string },
    );
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const [command, url] = argv._;
  if (!command) {
    process.stderr.write(USAGE);
    process.exit(2);
  }

  try {
    switch (command) {
      case 'open':
        await openCmd.run({ url, state: argv.state, timeout: argv.timeout });
        break;
      case 'extract-text':
        await extractTextCmd.run({
          url,
          state: argv.state,
          selector: argv.selector,
          timeout: argv.timeout,
        });
        break;
      case 'snapshot':
        await snapshotCmd.run({
          url,
          state: argv.state,
          interesting: argv.interesting,
          timeout: argv.timeout,
        });
        break;
      case 'screenshot':
        await screenshotCmd.run({
          url,
          state: argv.state,
          output: argv.output ?? '',
          fullPage: argv['full-page'],
          timeout: argv.timeout,
        });
        break;
      case 'state-save':
        await stateSaveCmd.run({
          url,
          state: argv.state,
          output: argv.output ?? '',
          timeout: argv.timeout,
        });
        break;
      default:
        process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
        process.exit(2);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
    process.exit(1);
  }
}

main();
