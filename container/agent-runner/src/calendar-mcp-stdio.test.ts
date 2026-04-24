/**
 * Tests for the Calendar MCP server's fetch logic.
 */
import { describe, it, expect, afterEach, spyOn } from 'bun:test';

const BASE = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API ${res.status}: ${body}`);
  }
  return res.json();
}

let fetchSpy: ReturnType<typeof spyOn>;

function mockFetchOk(data: unknown) {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200 }),
  );
}

function mockFetchError(status: number, body: string) {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { status }),
  );
}

afterEach(() => {
  fetchSpy?.mockRestore();
});

describe('calendarFetch', () => {
  it('constructs correct URL for list calendars', async () => {
    mockFetchOk({ items: [{ id: 'primary', summary: 'My Calendar' }] });

    const result = await calendarFetch('/users/me/calendarList');

    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/users/me/calendarList`);
    expect(result).toEqual({ items: [{ id: 'primary', summary: 'My Calendar' }] });
  });

  it('constructs correct URL for list events with time range', async () => {
    mockFetchOk({ items: [] });

    const cal = 'primary';
    const min = '2026-04-23T00:00:00Z';
    const max = '2026-04-30T00:00:00Z';
    await calendarFetch(
      `/calendars/${cal}/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&maxResults=25&singleEvents=true&orderBy=startTime`,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      `${BASE}/calendars/primary/events?timeMin=2026-04-23T00%3A00%3A00Z&timeMax=2026-04-30T00%3A00%3A00Z&maxResults=25&singleEvents=true&orderBy=startTime`,
    );
  });

  it('constructs correct URL for get event', async () => {
    mockFetchOk({ id: 'ev1', summary: 'Meeting' });

    await calendarFetch('/calendars/primary/events/ev1');

    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/calendars/primary/events/ev1`);
  });

  it('encodes non-primary calendar IDs', async () => {
    mockFetchOk({ items: [] });

    const cal = encodeURIComponent('user@example.com');
    await calendarFetch(`/calendars/${cal}/events?timeMin=2026-04-23T00%3A00%3A00Z&timeMax=2026-04-30T00%3A00%3A00Z&maxResults=25&singleEvents=true&orderBy=startTime`);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/calendars/user%40example.com/events?'),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetchError(401, 'Unauthorized');

    await expect(calendarFetch('/users/me/calendarList')).rejects.toThrow(
      'Calendar API 401: Unauthorized',
    );
  });

  it('throws on 403 with error details', async () => {
    mockFetchError(403, '{"error": "forbidden"}');

    await expect(calendarFetch('/calendars/primary/events')).rejects.toThrow(
      'Calendar API 403: {"error": "forbidden"}',
    );
  });
});
