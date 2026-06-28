const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 5177);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return cleanText(value);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/gi, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function toIsoDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  const date = new Date(text);
  if (!Number.isNaN(date.valueOf())) return date.toISOString();
  return "";
}

function pickLocalizedName(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return (
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("en"))?.Description ||
    value[0]?.Description ||
    ""
  );
}

function isFifaWorldCupUrl(url) {
  return (
    /(^|\.)fifa\.com$/i.test(url.hostname) &&
    /\/tournaments\/mens\/worldcup\/canadamexicousa2026\/scores-fixtures/i.test(url.pathname)
  );
}

function isWnbaScheduleUrl(url) {
  return /(^|\.)wnba\.com$/i.test(url.hostname) && /^\/schedule\/?$/i.test(url.pathname);
}

function getFifaTeamName(team, placeholder) {
  return (
    pickLocalizedName(team?.TeamName) ||
    team?.ShortClubName ||
    team?.Abbreviation ||
    placeholder ||
    "TBD"
  );
}

function mapFifaMatchToEvent(match, sourceUrl) {
  const start = toIsoDate(match.Date);
  if (!start) return null;

  const home = getFifaTeamName(match.Home, match.PlaceHolderA);
  const away = getFifaTeamName(match.Away, match.PlaceHolderB);
  const stadium = pickLocalizedName(match.Stadium?.Name);
  const city = pickLocalizedName(match.Stadium?.CityName);
  const country = match.Stadium?.IdCountry;
  const stage = pickLocalizedName(match.StageName);
  const group = pickLocalizedName(match.GroupName);
  const matchUrl = `https://www.fifa.com/en/match-centre/match/${match.IdCompetition}/${match.IdSeason}/${match.IdStage}/${match.IdMatch}`;

  return {
    uid: `fifa-${match.IdCompetition}-${match.IdSeason}-${match.IdStage}-${match.IdMatch}@race-calendar-importer.local`,
    title: `FIFA World Cup: ${home} vs ${away}`,
    start,
    end: new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString(),
    location: [stadium, city, country].filter(Boolean).join(", "),
    description: [
      match.MatchNumber ? `Match ${match.MatchNumber}` : "",
      stage,
      group,
      `Source: ${sourceUrl}`,
    ]
      .filter(Boolean)
      .join(" | "),
    url: matchUrl,
    source: "fifa-api",
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Race Calendar Importer/1.0",
      accept: "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.hostname}`);
  }

  return response.json();
}

async function collectFifaWorldCupEvents(sourceUrl) {
  const apiUrl = new URL("https://api.fifa.com/api/v3/calendar/matches");
  apiUrl.searchParams.set("idSeason", "285023");
  apiUrl.searchParams.set("language", "en");
  apiUrl.searchParams.set("count", "500");

  const data = await fetchJson(apiUrl);
  return (data.Results || [])
    .map((match) => mapFifaMatchToEvent(match, sourceUrl))
    .filter(Boolean);
}

function getWnbaTeamName(team) {
  if (!team) return "TBD";
  return [team.teamCity, team.teamName].filter(Boolean).join(" ") || team.teamTricode || "TBD";
}

function mapWnbaGameToEvent(game, sourceUrl) {
  const start = toIsoDate(game.gameDateTimeUTC || game.gameDateTimeEst);
  if (!start) return null;

  const away = getWnbaTeamName(game.awayTeam);
  const home = getWnbaTeamName(game.homeTeam);
  const broadcasters = [
    ...(game.broadcasters?.nationalBroadcasters || []),
    ...(game.broadcasters?.nationalTvBroadcasters || []),
    ...(game.broadcasters?.nationalOttBroadcasters || []),
  ]
    .map((broadcaster) => broadcaster.broadcasterDisplay)
    .filter(Boolean);

  return {
    uid: game.gameId ? `wnba-${game.gameId}@race-calendar-importer.local` : "",
    title: `WNBA: ${away} at ${home}`,
    start,
    end: new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString(),
    location: [game.arenaName, game.arenaCity, game.arenaState].filter(Boolean).join(", "),
    description: [
      game.seasonType,
      game.gameLabel,
      game.gameSubLabel,
      broadcasters.length ? `Broadcast: ${[...new Set(broadcasters)].join(", ")}` : "",
      `Game ID: ${game.gameId}`,
      `Source: ${sourceUrl}`,
    ]
      .filter(Boolean)
      .join(" | "),
    url: game.gameId ? `https://www.wnba.com/game/${game.gameId}` : sourceUrl,
    source: "wnba-api",
  };
}

async function collectWnbaEvents(parsedTarget) {
  const season = parsedTarget.searchParams.get("season") || String(new Date().getFullYear());
  const regionId = parsedTarget.searchParams.get("regionId") || "1";
  const apiUrl = new URL("https://www.wnba.com/api/schedule");
  apiUrl.searchParams.set("season", season);
  apiUrl.searchParams.set("regionId", regionId);

  const data = await fetchJson(apiUrl, {
    accept: "application/json",
    referer: parsedTarget.href,
  });

  return (data.leagueSchedule?.gameDates || [])
    .flatMap((dateGroup) => dateGroup.games || [])
    .map((game) => mapWnbaGameToEvent(game, parsedTarget.href))
    .filter(Boolean);
}

function eventFromSchema(rawEvent, sourceUrl) {
  const start = toIsoDate(rawEvent.startDate);
  if (!start) return null;

  const end = toIsoDate(rawEvent.endDate);
  const location =
    typeof rawEvent.location === "string"
      ? rawEvent.location
      : [
          rawEvent.location?.name,
          rawEvent.location?.address?.addressLocality,
          rawEvent.location?.address?.addressRegion,
          rawEvent.location?.address?.addressCountry,
        ]
          .filter(Boolean)
          .join(", ");

  return {
    title: stripTags(rawEvent.name || rawEvent.headline || "World Cup event"),
    start,
    end,
    location: stripTags(location),
    description: stripTags(rawEvent.description || ""),
    url: rawEvent.url || sourceUrl,
    source: "structured-data",
  };
}

function collectJsonLdEvents(html, sourceUrl) {
  const events = [];
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const match of matches) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const queue = [...nodes];

      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }

        const type = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (type.some((item) => String(item).toLowerCase() === "event")) {
          const event = eventFromSchema(node, sourceUrl);
          if (event) events.push(event);
        }

        for (const value of Object.values(node)) {
          if (value && typeof value === "object") queue.push(value);
        }
      }
    } catch {
      // Ignore invalid JSON-LD blocks; many sites include tracking fragments here.
    }
  }

  return events;
}

function collectNextDataEvents(html, sourceUrl) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];

  try {
    const parsed = JSON.parse(decodeEntities(match[1]));
    return collectEventsFromJson(parsed, sourceUrl);
  } catch {
    return [];
  }
}

function collectEventsFromJson(value, sourceUrl) {
  const events = [];
  const queue = [value];
  const seen = new WeakSet();

  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    if (seen.has(item)) continue;
    seen.add(item);

    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }

    const start =
      toIsoDate(item.startDate) ||
      toIsoDate(item.eventDate) ||
      toIsoDate(item.gameDateTimeUTC) ||
      toIsoDate(item.gameDateTimeEst) ||
      toIsoDate(item.dateISO);

    const title =
      item.title ||
      item.name ||
      item.summary ||
      (item.homeTeam && item.awayTeam
        ? `${getWnbaTeamName(item.awayTeam)} at ${getWnbaTeamName(item.homeTeam)}`
        : "");

    if (start && title) {
      const location =
        item.location ||
        [item.arenaName, item.arenaCity, item.arenaState].filter(Boolean).join(", ");

      events.push({
        title: stripTags(title),
        start,
        end: toIsoDate(item.endDate) || new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString(),
        location: stripTags(location),
        description: stripTags(item.description || item.eventDescription || `Imported from ${sourceUrl}`),
        url: item.url || item.linkUrl || sourceUrl,
        source: "embedded-json",
      });
    }

    queue.push(...Object.values(item).filter((child) => child && typeof child === "object"));
  }

  return events;
}

function parseDateFromText(text) {
  const withYear =
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\.?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;
  const numeric = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2})?\b/;
  const match = text.match(withYear) || text.match(numeric);
  if (!match) return "";

  let candidate = match[0].replace(/\bSept\b/i, "Sep");
  if (!/\b\d{4}\b/.test(candidate)) {
    candidate = `${candidate}, ${new Date().getFullYear()}`;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function collectTableEvents(html, sourceUrl) {
  const events = [];
  const rowMatches = html.matchAll(/<tr[\s\S]*?<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      stripTags(cell[1])
    );
    if (cells.length < 2) continue;

    const rowText = cells.join(" | ");
    const start = parseDateFromText(rowText);
    if (!start) continue;

    const title =
      cells.find((cell) => /world cup|race|grand prix|downhill|slalom|qualifying|final|match/i.test(cell)) ||
      cells.find((cell) => !parseDateFromText(cell)) ||
      "World Cup event";

    const location =
      cells.find((cell) => /,|stadium|arena|circuit|resort|park|course|track/i.test(cell) && cell !== title) || "";

    events.push({
      title,
      start,
      end: "",
      location,
      description: rowText,
      url: sourceUrl,
      source: "table",
    });
  }

  return events;
}

function collectTextEvents(html, sourceUrl) {
  const events = [];
  const text = cleanText(html);
  const chunks = text
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 20 && chunk.length < 260);

  for (const chunk of chunks) {
    const start = parseDateFromText(chunk);
    if (!start) continue;

    events.push({
      title: chunk.replace(/\s*\|.*$/, "").slice(0, 90) || "World Cup event",
      start,
      end: "",
      location: "",
      description: chunk,
      url: sourceUrl,
      source: "text",
    });
  }

  return events;
}

function dedupeEvents(events) {
  const seen = new Set();
  const cleanEvents = [];

  for (const event of events) {
    const key = `${event.title}|${event.start}|${event.location}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleanEvents.push({
      ...event,
      id: Buffer.from(key).toString("base64url").slice(0, 32),
    });
  }

  return cleanEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
}

async function extractEvents(req, res) {
  const target = new URL(req.url, `http://${req.headers.host}`).searchParams.get("url");
  if (!target) {
    sendJson(res, 400, { error: "Missing url parameter." });
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(target);
  } catch {
    sendJson(res, 400, { error: "Please enter a valid URL." });
    return;
  }

  if (!["http:", "https:"].includes(parsedTarget.protocol)) {
    sendJson(res, 400, { error: "Only http and https URLs are supported." });
    return;
  }

  try {
    if (isFifaWorldCupUrl(parsedTarget)) {
      const events = dedupeEvents(await collectFifaWorldCupEvents(parsedTarget.href));
      sendJson(res, 200, {
        pageTitle: "FIFA World Cup 2026 Scores & Fixtures",
        sourceUrl: parsedTarget.href,
        events,
      });
      return;
    }

    if (isWnbaScheduleUrl(parsedTarget)) {
      const events = dedupeEvents(await collectWnbaEvents(parsedTarget));
      sendJson(res, 200, {
        pageTitle: `WNBA ${parsedTarget.searchParams.get("season") || ""} Schedule`.trim(),
        sourceUrl: parsedTarget.href,
        events,
      });
      return;
    }

    const response = await fetch(parsedTarget, {
      headers: {
        "user-agent": "Race Calendar Importer/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      sendJson(res, response.status, { error: `The page returned HTTP ${response.status}.` });
      return;
    }

    const html = await response.text();
    const events = dedupeEvents([
      ...collectJsonLdEvents(html, parsedTarget.href),
      ...collectNextDataEvents(html, parsedTarget.href),
      ...collectTableEvents(html, parsedTarget.href),
      ...collectTextEvents(html, parsedTarget.href),
    ]);

    sendJson(res, 200, {
      pageTitle: stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || parsedTarget.hostname),
      sourceUrl: parsedTarget.href,
      events,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `Could not fetch this page: ${error.message}`,
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/extract") {
    extractEvents(req, res);
    return;
  }

  sendStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Race Calendar Importer running at http://localhost:${PORT}`);
});
