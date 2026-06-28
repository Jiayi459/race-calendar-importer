const urlForm = document.querySelector("#urlForm");
const sourceUrlInput = document.querySelector("#sourceUrl");
const statusLine = document.querySelector("#statusLine");
const downloadFallback = document.querySelector("#downloadFallback");
const eventsBody = document.querySelector("#eventsBody");
const rowTemplate = document.querySelector("#eventRowTemplate");
const downloadButton = document.querySelector("#downloadButton");
const addEventButton = document.querySelector("#addEventButton");
const sampleButton = document.querySelector("#sampleButton");
const calendarTitleInput = document.querySelector("#calendarTitle");
const defaultDurationSelect = document.querySelector("#defaultDuration");
const reminderMinutesSelect = document.querySelector("#reminderMinutes");

let currentSourceUrl = "";

const sampleEvents = [
  {
    title: "World Cup Race - Downhill",
    start: "2026-01-24T10:30:00.000Z",
    end: "2026-01-24T12:30:00.000Z",
    location: "Kitzbuhel, Austria",
    url: "https://example.com/world-cup-schedule",
  },
  {
    title: "World Cup Race - Slalom",
    start: "2026-01-25T09:15:00.000Z",
    end: "2026-01-25T11:15:00.000Z",
    location: "Kitzbuhel, Austria",
    url: "https://example.com/world-cup-schedule",
  },
];

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle("error", isError);
}

function clearDownloadFallback() {
  downloadFallback.hidden = true;
  downloadFallback.innerHTML = "";
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function readRows() {
  return [...eventsBody.querySelectorAll("tr[data-event-row]")].map((row) => {
    const start = fromLocalInputValue(row.querySelector(".start-input").value);
    const end = fromLocalInputValue(row.querySelector(".end-input").value);
    return {
      uid: row.dataset.uid || "",
      url: row.dataset.url || "",
      description: row.dataset.description || "",
      source: row.dataset.source || "",
      include: row.querySelector(".include-input").checked,
      title: row.querySelector(".title-input").value.trim(),
      start,
      end,
      location: row.querySelector(".location-input").value.trim(),
    };
  });
}

function updateDownloadState() {
  const hasUsableEvent = readRows().some((event) => event.include && event.title && event.start);
  downloadButton.disabled = !hasUsableEvent;
}

function clearRows() {
  eventsBody.innerHTML = "";
}

function renderEmptyRow() {
  eventsBody.innerHTML = '<tr class="empty-row"><td colspan="6">No events extracted yet.</td></tr>';
  updateDownloadState();
}

function addEventRow(event = {}) {
  if (eventsBody.querySelector(".empty-row")) clearRows();

  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.eventRow = "true";
  row.dataset.uid = event.uid || event.id || "";
  row.dataset.url = event.url || "";
  row.dataset.description = event.description || "";
  row.dataset.source = event.source || "";
  row.querySelector(".title-input").value = event.title || "";
  row.querySelector(".start-input").value = toLocalInputValue(event.start);

  const defaultDuration = Number(defaultDurationSelect.value || 120);
  const startDate = event.start ? new Date(event.start) : null;
  const fallbackEnd = startDate && defaultDuration !== 1440 ? addMinutes(startDate, defaultDuration) : null;
  row.querySelector(".end-input").value = toLocalInputValue(event.end || fallbackEnd);
  row.querySelector(".location-input").value = event.location || "";
  row.querySelector(".remove-button").addEventListener("click", () => {
    row.remove();
    if (!eventsBody.querySelector("tr[data-event-row]")) renderEmptyRow();
    updateDownloadState();
  });

  row.addEventListener("input", updateDownloadState);
  eventsBody.append(row);
  updateDownloadState();
}

function renderEvents(events) {
  clearRows();

  if (!events.length) {
    renderEmptyRow();
    return;
  }

  for (const event of events) addEventRow(event);
  setStatus(`${events.length} event${events.length === 1 ? "" : "s"} ready. Review them before downloading.`);
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function foldIcsLine(line) {
  const maxLength = 74;
  const chunks = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = ` ${remaining.slice(maxLength)}`;
  }

  chunks.push(remaining);
  return chunks;
}

function serializeIcsLines(lines) {
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

function makeUid(event, index) {
  if (event.uid) {
    return event.uid.includes("@") ? event.uid : `${event.uid}@race-calendar-importer.local`;
  }

  const key = `${event.title}-${event.start?.toISOString()}-${event.location}-${index}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return `${hash}@race-calendar-importer.local`;
}

function buildIcs() {
  const duration = Number(defaultDurationSelect.value || 120);
  const reminder = reminderMinutesSelect.value ? Number(reminderMinutesSelect.value) : null;
  const events = readRows().filter((event) => event.include && event.title && event.start);
  const now = formatIcsDate(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Race Calendar Importer//Race Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarTitleInput.value || "Race Calendar")}`,
  ];

  events.forEach((event, index) => {
    const isAllDay = duration === 1440;
    const end = event.end || (isAllDay ? addMinutes(event.start, 1440) : addMinutes(event.start, duration));

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${makeUid(event, index)}`);
    lines.push(`DTSTAMP:${now}`);

    if (isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.start).slice(0, 8)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDate(end).slice(0, 8)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDate(event.start)}`);
      lines.push(`DTEND:${formatIcsDate(end)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    const eventUrl = event.url || currentSourceUrl;
    if (eventUrl) lines.push(`URL:${escapeIcsText(eventUrl)}`);
    const description = [
      event.description,
      `Imported from Race Calendar Importer${currentSourceUrl ? `\n${currentSourceUrl}` : ""}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);

    if (reminder !== null) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcsText(event.title)}`);
      lines.push(`TRIGGER:-PT${reminder}M`);
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  return {
    content: serializeIcsLines(lines),
    eventCount: events.length,
  };
}

function downloadIcs() {
  const { content, eventCount } = buildIcs();
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  const title = calendarTitleInput.value || "race-calendar";
  const objectUrl = URL.createObjectURL(blob);
  const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "calendar"}.ics`;

  clearDownloadFallback();
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();

  const fallbackLink = document.createElement("a");
  fallbackLink.href = objectUrl;
  fallbackLink.download = fileName;
  fallbackLink.textContent = "Download file";
  downloadFallback.append("If the download did not start, use this link: ", fallbackLink);
  downloadFallback.hidden = false;
  setStatus(`Prepared ${fileName} with ${eventCount} event${eventCount === 1 ? "" : "s"}. Open the .ics file with Apple Calendar after it downloads.`);

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    clearDownloadFallback();
  }, 120_000);
}

urlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = sourceUrlInput.value.trim();
  if (!url) return;

  currentSourceUrl = url;
  clearDownloadFallback();
  setStatus("Fetching and extracting events...");
  downloadButton.disabled = true;

  try {
    const response = await fetch(`/extract?url=${encodeURIComponent(url)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not extract this page.");
    }

    renderEvents(payload.events || []);
    if (!payload.events?.length) {
      setStatus("No events were found. Try a more specific schedule page or add events manually.", true);
    }
  } catch (error) {
    setStatus(error.message, true);
    updateDownloadState();
  }
});

addEventButton.addEventListener("click", () => {
  addEventRow({
    title: "World Cup Race",
    start: new Date().toISOString(),
    location: "",
  });
});

sampleButton.addEventListener("click", () => {
  currentSourceUrl = "https://example.com/world-cup-schedule";
  sourceUrlInput.value = currentSourceUrl;
  renderEvents(sampleEvents);
});

downloadButton.addEventListener("click", downloadIcs);
defaultDurationSelect.addEventListener("change", updateDownloadState);
reminderMinutesSelect.addEventListener("change", updateDownloadState);
