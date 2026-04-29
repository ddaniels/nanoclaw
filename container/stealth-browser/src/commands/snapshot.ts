import { launchStealthBrowser } from '../browser.js';

interface Args {
  url: string;
  state?: string;
  interesting?: boolean;
  timeout?: number;
}

export async function run(args: Args): Promise<void> {
  if (!args.url) {
    throw new Error('snapshot: --url is required');
  }
  const { browser, page } = await launchStealthBrowser({ statePath: args.state });
  try {
    await page.goto(args.url, {
      waitUntil: 'domcontentloaded',
      timeout: args.timeout ?? 30000,
    });
    const tree = await page.accessibility.snapshot({ interestingOnly: args.interesting ?? true });
    process.stdout.write(JSON.stringify({ ok: true, url: page.url(), title: await page.title(), tree }) + '\n');
  } finally {
    await browser.close().catch(() => {});
  }
}
