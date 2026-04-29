import { launchStealthBrowser } from '../browser.js';

interface Args {
  url: string;
  state?: string;
  selector?: string;
  timeout?: number;
}

export async function run(args: Args): Promise<void> {
  if (!args.url) {
    throw new Error('extract-text: --url is required');
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

    let text: string;
    if (args.selector) {
      // First match only — keep behavior simple. Throws if selector matches nothing.
      text = await page.locator(args.selector).first().innerText({ timeout: 10000 });
    } else {
      text = await page.locator('body').innerText({ timeout: 10000 });
    }

    process.stdout.write(JSON.stringify({ ok: true, status, url: finalUrl, title, text }) + '\n');
  } finally {
    await browser.close().catch(() => {});
  }
}
