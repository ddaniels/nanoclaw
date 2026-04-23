---
name: weather
description: Get a weather report from the National Weather Service (api.weather.gov). Use when the user asks for weather, a forecast, or conditions for any U.S. location. Do NOT search the web or use other weather services — fetch directly from api.weather.gov using the two-step process below.
---

# Weather Report Skill

Fetch weather directly from the National Weather Service API (`api.weather.gov`). This is a **two-step process** — no search engine, no third-party services. Minimize Claude API calls by doing both fetches before generating any response.

## Step 1: Resolve coordinates → grid point

You need a latitude/longitude for the location. Use your knowledge to determine approximate coordinates (e.g., Pigeon Forge, TN ≈ 35.7881, -83.5549; New York City ≈ 40.7128, -74.0060).

Fetch:
```
https://api.weather.gov/points/{lat},{lon}
```

Extract from the response:
- `properties.gridId` (e.g., `MRX`)
- `properties.gridX` (e.g., `86`)
- `properties.gridY` (e.g., `41`)
- `properties.timeZone` (e.g., `America/New_York`)

**Elevation note:** For mountain/trail locations, the coordinates should match the trailhead or specific elevation of interest. If the user asks about a trail or summit, use coordinates as close to that point as possible.

## Step 2: Fetch the hourly forecast

**Always fetch the hourly forecast** — it is the primary data source for the report.

```
https://api.weather.gov/gridpoints/{gridId}/{gridX},{gridY}/forecast/hourly
```

From `properties.periods[]`, extract for each hour:
- `startTime` — ISO timestamp
- `temperature` + `temperatureUnit`
- `probabilityOfPrecipitation.value` — rain/snow chance as a percentage
- `shortForecast` — one-line summary (e.g., "Rain Showers", "Partly Cloudy")

Use this data to build the report (see Output format below).

## Elevation adjustment

NWS grid forecasts are computed for the grid cell's average elevation, which may differ from a specific trailhead or summit. Apply these general rules:

- Subtract ~3–5°F per 1,000 ft of elevation gain above the grid reference elevation
- Wind speeds increase with elevation — add 20–40% for exposed ridges/summits
- Precipitation probability is roughly similar but orographic lift can enhance it at higher elevations
- Snow/ice possible above ~4,000 ft in the Appalachians during Oct–May

Always note these are estimates when applying manual elevation adjustments.

## Alerts

Check for active alerts at:
```
https://api.weather.gov/alerts/active?point={lat},{lon}
```

Include any `Severe Thunderstorm Warning`, `Tornado Warning`, `Winter Storm Warning`, `High Wind Warning`, or `Hazardous Weather Outlook` in the report.

## Output format

The goal is: **"What am I walking into at each phase of the day — morning, midday, and late night?"**

Use the hourly forecast data to report exactly these items, in this order:

1. **Morning** — temp and conditions at the current hour (or 7 AM for future days). e.g., "7 AM: 47°F, light rain"
2. **High** — the peak temp and what time it hits. e.g., "High 54°F around 1 PM"
3. **Midnight** — temp at midnight. e.g., "Midnight: 42°F"
4. **Precipitation timeline** — list each meaningful change as a bullet with the time. Changes that matter: precip starts, stops, changes type (rain → snow), or significantly changes intensity (drizzle → heavy rain, showers → dry). Derive these from the hourly `shortForecast` and `probabilityOfPrecipitation` fields — look for transitions in the text (e.g., "Partly Cloudy" → "Rain Showers") or probability jumping from <20% to 40%+, or the reverse. Examples:
   - "Rain starts ~10 AM"
   - "Heavy rain 2–4 PM"
   - "Tapers to drizzle by 6 PM"
   - "Dry after 9 PM"
   If dry all day with no meaningful chance, just say "Dry all day" and skip the bullets.

If there are active alerts (severe weather, winter storm, etc.), append them.

**Do not include**: emoji, wind details (unless extreme/advisory-level), multi-day outlook, tables, or narrative prose. Just the data points above — short enough to read at a glance. Apply channel-appropriate formatting per the CLAUDE.md formatting rules.

## Example coordinates reference

| Location | Lat | Lon |
|---|---|---|
| Pigeon Forge / Gatlinburg, TN | 35.7881 | -83.5549 |
| Alum Cave Trail trailhead, TN | 35.7143 | -83.5102 |
| Mt. LeConte summit, TN | 35.6542 | -83.4432 |
| Nashville, TN | 36.1627 | -86.7816 |
| New York City, NY | 40.7128 | -74.0060 |
| Denver, CO | 39.7392 | -104.9903 |
| Seattle, WA | 47.6062 | -122.3321 |
| Miami, FL | 25.7617 | -80.1918 |
