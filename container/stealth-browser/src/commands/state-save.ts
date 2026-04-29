import fs from 'node:fs';
import { launchStealthBrowser } from '../browser.js';

interface Args {
  url: string;
  state?: string;
  output: string;
  timeout?: number;
}

/**
 * Refresh / save the storageState after navigating with an existing state.
 * Useful when a site rotates session cookies inside the browser and the
 * captured file gets stale faster than expected.
 */
export async function run(args: Args): Promise<void> {
  if (!args.url) {
    throw new Error('state-save: --url is required');
  }
  if (!args.output) {
    throw new Error('state-save: --output is required');
  }
  const { browser, context, page } = await launchStealthBrowser({ statePath: args.state });
  try {
    await page.goto(args.url, {
      waitUntil: 'domcontentloaded',
      timeout: args.timeout ?? 30000,
    });
    await context.storageState({ path: args.output });
    fs.chmodSync(args.output, 0o600);
    process.stdout.write(JSON.stringify({ ok: true, output: args.output }) + '\n');
  } finally {
    await browser.close().catch(() => {});
  }
}
