/**
 * Google Calendar read-only MCP server (stdio transport).
 *
 * Wraps the Calendar REST API. Does NOT set Authorization headers — requests
 * go through HTTPS_PROXY (OneCLI gateway) which injects the Bearer token
 * based on the host pattern (www.googleapis.com/calendar/*).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API ${res.status}: ${body}`);
  }
  return res.json();
}

const server = new McpServer({ name: 'calendar', version: '1.0.0' });

server.tool(
  'calendar_list_calendars',
  'List all calendars the user has access to.',
  {},
  async () => {
    const data = await calendarFetch('/users/me/calendarList');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'calendar_list_events',
  'List events from a calendar within a time range. Defaults to primary calendar and next 7 days.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    timeMin: z.string().optional().describe('Start of range, RFC3339 (e.g. "2026-04-23T00:00:00Z"). Defaults to now.'),
    timeMax: z.string().optional().describe('End of range, RFC3339. Defaults to 7 days from now.'),
    maxResults: z.number().optional().describe('Max events to return (default 25)'),
  },
  async ({ calendarId, timeMin, timeMax, maxResults }) => {
    const cal = encodeURIComponent(calendarId ?? 'primary');
    const now = new Date();
    const min = timeMin ?? now.toISOString();
    const max = timeMax ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const limit = maxResults ?? 25;
    const data = await calendarFetch(
      `/calendars/${cal}/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&maxResults=${limit}&singleEvents=true&orderBy=startTime`,
    );
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'calendar_get_event',
  'Get details for a specific calendar event.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    eventId: z.string().describe('Event ID from calendar_list_events'),
  },
  async ({ calendarId, eventId }) => {
    const cal = encodeURIComponent(calendarId ?? 'primary');
    const data = await calendarFetch(`/calendars/${cal}/events/${eventId}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
