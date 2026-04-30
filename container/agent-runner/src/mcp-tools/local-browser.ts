/**
 * MCP tools that drive a Chrome running on the host over CDP.
 *
 * The Bun-side tool spawns a Node subprocess (`local-browser-helper.mjs`)
 * per call because Bun's WebSocket client doesn't complete the CDP upgrade
 * handshake against Chrome — connecting hangs under Bun but works fine
 * under Node 22. The helper uses puppeteer-core (not playwright-core)
 * because Playwright's connectOverCDP calls Browser.setDownloadBehavior at
 * connect time, which user-launched Chrome rejects.
 *
 * Setup is host-side: `/add-local-browser-tool` skill installs a launchd
 * plist that runs Chrome with `--remote-debugging-port=9222`,
 * `--remote-allow-origins=*`, and a dedicated `--user-data-dir` so the
 * operator's logged-in cookies persist across restarts.
 */
import path from 'path';
import { fileURLToPath } from 'url';

import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

const HELPER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'local-browser-helper.mjs',
);

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

interface HelperResult {
  ok: boolean;
  error?: string;
  title?: string;
  final_url?: string;
  word_count?: number;
  screenshot_path?: string;
  text?: string;
  html?: string;
}

async function runHelper(request: Record<string, unknown>): Promise<HelperResult> {
  const proc = Bun.spawn(['node', HELPER_PATH, JSON.stringify(request)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (stdout.trim().length === 0) {
    return {
      ok: false,
      error: `helper produced no output (exit ${exitCode}): ${stderr.trim().slice(0, 500)}`,
    };
  }
  try {
    return JSON.parse(stdout) as HelperResult;
  } catch {
    return {
      ok: false,
      error: `helper returned non-JSON output (exit ${exitCode}): ${stdout.slice(0, 500)}`,
    };
  }
}

// Limit text returned to the model — full HTML for a Bloomberg article is
// ~500KB and blows out the context. innerText is usually under 30KB; cap at
// 50KB just in case.
const MAX_TEXT_BYTES = 50_000;

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated, ${s.length - max} more chars]`;
}

export const localBrowserFetchPage: McpToolDefinition = {
  tool: {
    name: 'local_browser_fetch_page',
    description:
      'Fetch a URL using the operator\'s logged-in Chrome on the host. Inherits cookies, ' +
      'so paywalled/authenticated pages work the same as in the operator\'s normal browser. ' +
      'Returns the rendered text, title, final URL, and a screenshot path.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        wait_ms: {
          type: 'integer',
          description: 'Milliseconds to wait after DOMContentLoaded for lazy paywall scripts (default 3000)',
        },
      },
      required: ['url'],
    },
  },
  async handler(args) {
    const url = args.url as string;
    if (!url) return err('url is required');

    const result = await runHelper({ op: 'fetch_page', url, wait_ms: args.wait_ms });
    if (!result.ok) return err(result.error || 'helper failed');

    const text = truncate(result.text, MAX_TEXT_BYTES);
    const summary = [
      `Fetched: ${result.final_url}`,
      `Title: ${result.title}`,
      `Word count: ${result.word_count}`,
      `Screenshot: ${result.screenshot_path}`,
      '',
      '— Page text —',
      text,
    ].join('\n');
    return ok(summary);
  },
};

export const localBrowserScreenshot: McpToolDefinition = {
  tool: {
    name: 'local_browser_screenshot',
    description:
      'Take a screenshot of a URL using the operator\'s logged-in Chrome on the host. ' +
      'Returns the path of the saved PNG (under /workspace/agent/local-browser-screenshots/).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to capture' },
        full_page: {
          type: 'boolean',
          description: 'Capture entire scrollable page (default false — viewport only)',
        },
      },
      required: ['url'],
    },
  },
  async handler(args) {
    const url = args.url as string;
    if (!url) return err('url is required');

    const result = await runHelper({
      op: 'screenshot',
      url,
      full_page: args.full_page === true,
    });
    if (!result.ok) return err(result.error || 'helper failed');

    return ok(`Screenshot saved: ${result.screenshot_path} (final URL: ${result.final_url})`);
  },
};

registerTools([localBrowserFetchPage, localBrowserScreenshot]);
