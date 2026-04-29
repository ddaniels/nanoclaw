import { launchStealthBrowser } from '../browser.js';

interface Args {
  url: string;
  state?: string;
  timeout?: number;
}

export async function run(args: Args): Promise<void> {
  if (!args.url) {
    throw new Error('open: --url is required');
  }
  const { browser, page } = await launchStealthBrowser({ statePath: args.state });
  try {
    const response = await page.goto(args.url, {
      waitUntil: 'domcontentloaded',
      timeout: args.timeout ?? 30000,
    });
    const status = response?.status() ?? null;
    const finalUrl = page.url();
    const title = await page.title().catch(() => '');
    process.stdout.write(JSON.stringify({ ok: true, status, url: finalUrl, title }) + '\n');
  } finally {
    await browser.close().catch(() => {});
  }
}
