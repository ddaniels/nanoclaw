#!/usr/bin/env node
// Node helper that drives a host-side Chrome over CDP. Spawned by
// mcp-tools/local-browser.ts; reads a JSON request on argv[2], writes a JSON
// response on stdout, exits.
//
// Why Node and not Bun: Bun's WebSocket client doesn't complete the CDP
// upgrade handshake against Chrome — connectOverCDP hangs at "ws connecting".
// Same Playwright code under Node 22 works fine.
//
// Why we resolve the hostname to an IP before connecting: Chrome's CDP
// rejects WebSocket Host headers that aren't an IP address or "localhost".
// Connecting to "host.docker.internal:9222" makes Playwright send
// `Host: host.docker.internal:9222`, which Chrome rejects. Resolving to
// the IP first makes the Host header `<ip>:9222`, which Chrome accepts.
// This lets Chrome stay bound to 127.0.0.1 (no LAN exposure) while still
// being reachable from the container via Docker Desktop's vpnkit forwarding.

import { lookup } from 'node:dns/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { chromium } from 'playwright-core';

const DEFAULT_HOST = 'host.docker.internal';
const DEFAULT_PORT = '9222';
const SCREENSHOT_DIR = '/workspace/agent/local-browser-screenshots';

async function resolveCdpUrl() {
  const host = process.env.LOCAL_BROWSER_CDP_HOST || DEFAULT_HOST;
  const port = process.env.LOCAL_BROWSER_CDP_PORT || DEFAULT_PORT;
  const { address } = await lookup(host);
  return `http://${address}:${port}`;
}

async function withBrowser(fn) {
  const cdpUrl = await resolveCdpUrl();
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function fetchPage(args) {
  const url = args.url;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  const waitMs = typeof args.wait_ms === 'number' ? args.wait_ms : 3000;

  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (waitMs > 0) await page.waitForTimeout(waitMs);

    const finalUrl = page.url();
    const title = await page.title();
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

    const screenshotPath = `${SCREENSHOT_DIR}/${Date.now()}-fetch.png`;
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return {
      ok: true,
      title,
      final_url: finalUrl,
      word_count: wordCount,
      screenshot_path: screenshotPath,
      text,
      html,
    };
  });
}

async function screenshot(args) {
  const url = args.url;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  const fullPage = args.full_page === true;

  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);

    const screenshotPath = `${SCREENSHOT_DIR}/${Date.now()}-screenshot.png`;
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage });

    return { ok: true, screenshot_path: screenshotPath, final_url: page.url() };
  });
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'missing request JSON in argv[2]' }));
    process.exit(2);
  }
  const req = JSON.parse(raw);
  const op = req.op;

  let result;
  if (op === 'fetch_page') result = await fetchPage(req);
  else if (op === 'screenshot') result = await screenshot(req);
  else throw new Error(`unknown op: ${op}`);

  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  process.exit(1);
});
