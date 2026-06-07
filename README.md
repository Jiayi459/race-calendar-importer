# Race Calendar Importer

A small local tool that extracts event dates from a schedule URL, lets you review and edit them, and downloads an `.ics` file for Apple Calendar.

## Why this is HTML plus a tiny server

A static HTML file can create an Apple Calendar file, but it usually cannot fetch arbitrary schedule URLs because browsers enforce CORS. This project uses a tiny dependency-free Node server for the URL fetch and extraction step, then the browser handles review and `.ics` generation.

## Run it

Clone the repo:

```bash
git clone https://github.com/Jiayi459/race-calendar-importer.git
cd race-calendar-importer
```

Start the local server:

```bash
npm start
```

Then open:

```text
http://localhost:5177
```

No dependency install is needed right now because the app only uses built-in Node.js APIs. You just need Node.js installed.

## Use it

1. Paste a schedule URL.
2. Click **Extract**.
3. Review, edit, add, or remove events.
4. Click **Download ICS**.
5. Open the downloaded `.ics` file with Apple Calendar.

## Current extraction strategy

The importer looks for:

- FIFA World Cup 2026 fixtures via FIFA's public match API
- WNBA schedule pages via WNBA's public schedule API
- JSON-LD `schema.org/Event` data
- embedded Next.js event-like JSON
- HTML table rows with dates
- date-looking text snippets

This is intentionally an MVP. Official schedule pages with structured or public API data work best. Some JavaScript-rendered pages may need a future Playwright-powered fetcher or site-specific adapter.
