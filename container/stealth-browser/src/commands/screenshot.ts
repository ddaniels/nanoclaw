import { launchStealthBrowser } from '../browser.js';

interface Args {
  url: string;
  state?: string;
  output: string;
  fullPage?: boolean;
  timeout?: number;
}

export async function run(args: Args): Promise<void> {
  if (!args.url) {
    throw new Error('screenshot: --url is required');
  }
  if (!args.output) {
    throw new Error('screenshot: --output is required');
  }
  const { browser, page } = await launchStealthBrowser({ statePath: args.state });
  try {
    await page.goto(args.url, {
      waitUntil: 'domcontentloaded',
      timeout: args.timeout ?? 30000,
    });
    await page.screenshot({ path: args.output, fullPage: args.fullPage ?? false });
    process.stdout.write(JSON.stringify({ ok: true, url: page.url(), output: args.output }) + '\n');
  } finally {
    await browser.close().catch(() => {});
  }
}
