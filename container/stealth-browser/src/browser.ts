import { chromium as rebrowserChromium, type Browser, type BrowserContext, type Page } from 'rebrowser-playwright';
import { addExtra, type PlaywrightCompatibleLauncher } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';

export interface LaunchOptions {
  statePath?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
}

export interface LaunchedSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const DEFAULT_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
];

// Wrap rebrowser-playwright's chromium with playwright-extra so we can layer
// puppeteer-extra-plugin-stealth on top. Two stealth layers: rebrowser-patches
// (CDP-level, baked into rebrowser-playwright at install time) plus stealth-plugin
// (Page-level addInitScript evasions). Sites like Bloomberg's PerimeterX check
// for telltales at both layers, so we apply both.
const stealthChromium = addExtra(rebrowserChromium as unknown as PlaywrightCompatibleLauncher);
stealthChromium.use(StealthPlugin());

// Realistic recent Chrome UA that matches what stealth-plugin overrides
// `navigator.userAgent` to. We pass it at the context level so the HTTP
// `User-Agent` header matches the JS value — otherwise PerimeterX/Akamai/etc.
// can flag the JS-vs-header mismatch. Bumped manually when Chromium in the
// image bumps; it just needs to be plausible for a desktop user.
const STEALTH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export async function launchStealthBrowser(opts: LaunchOptions = {}): Promise<LaunchedSession> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new Error(
      'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is not set. The container Dockerfile sets this; bare invocations need it explicit.',
    );
  }

  if (opts.statePath && !fs.existsSync(opts.statePath)) {
    throw new Error(`storageState path does not exist: ${opts.statePath}`);
  }

  const browser: Browser = await stealthChromium.launch({
    executablePath,
    headless: true,
    args: DEFAULT_LAUNCH_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    storageState: opts.statePath,
    viewport: opts.viewport ?? DEFAULT_VIEWPORT,
    userAgent: opts.userAgent ?? STEALTH_USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();
  return { browser, context, page };
}
