const STORAGE_KEYS = {
    settings: "mca_settings",
    db: "mca_db",
};

const DEFAULT_SETTINGS = {
    calendarUrl: "",
    keywordGroups: {
        Migraine: ["migraine", "headache"],
        Medication: ["medication", "pill", "sumatriptan"],
    },
};

const DEFAULT_DB = {
    events: [],
    lastSyncAt: null,
};

const state = {
    settings: loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
    db: loadJson(STORAGE_KEYS.db, DEFAULT_DB),
    dailyChart: null,
    weeklyChart: null,
    weekdayChart: null,
};

const elements = {
    settingsDialog: document.getElementById("settingsDialog"),
    settingsForm: document.getElementById("settingsForm"),
    calendarUrl: document.getElementById("calendarUrl"),
    keywordGroups: document.getElementById("keywordGroups"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    updateBtn: document.getElementById("updateBtn"),
    rangePreset: document.getElementById("rangePreset"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    statsGrid: document.getElementById("statsGrid"),
    monthlyCalendars: document.getElementById("monthlyCalendars"),
    unrecognizedKeywordsList: document.getElementById(
        "unrecognizedKeywordsList",
    ),
    allEventsTableBody: document.getElementById("allEventsTableBody"),
    dailyChartCanvas: document.getElementById("dailyChart"),
    weeklyChartCanvas: document.getElementById("weeklyChart"),
    weekdayChartCanvas: document.getElementById("weekdayChart"),
};

init();

function init() {
    elements.calendarUrl.value = state.settings.calendarUrl || "";
    bindEvents();
    renderKeywordGroups();
    elements.rangePreset.value = "this_year";
    applyPreset("this_year");
    renderAll();

    if (!state.settings.calendarUrl) {
        elements.settingsDialog.showModal();
    }
}

function bindEvents() {
    elements.openSettingsBtn.addEventListener("click", () => {
        elements.settingsDialog.showModal();
    });

    elements.closeSettingsBtn.addEventListener("click", () => {
        elements.settingsDialog.close();
    });

    elements.settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveSettings();
        elements.settingsDialog.close();
    });

    elements.keywordGroups.addEventListener("click", (event) => {
        const removeBtn = event.target.closest("button[data-remove-group]");
        if (removeBtn) {
            removeKeyword(
                removeBtn.dataset.removeGroup,
                removeBtn.dataset.keyword,
            );
            return;
        }

        const addBtn = event.target.closest("button[data-add-group]");
        if (addBtn) {
            const group = addBtn.dataset.addGroup;
            const input = elements.keywordGroups.querySelector(
                `input[data-input-group="${escapeCss(group)}"]`,
            );
            addKeyword(group, input.value);
            input.value = "";
        }
    });

    elements.keywordGroups.addEventListener("keydown", (event) => {
        const input = event.target.closest("input[data-input-group]");
        if (!input || event.key !== "Enter") return;
        event.preventDefault();
        addKeyword(input.dataset.inputGroup, input.value);
        input.value = "";
    });

    elements.updateBtn.addEventListener("click", handleCalendarUpdate);

    elements.rangePreset.addEventListener("change", () => {
        applyPreset(elements.rangePreset.value);
        renderAll();
    });

    elements.startDate.addEventListener("change", () => {
        elements.rangePreset.value = "custom";
        renderAll();
    });

    elements.endDate.addEventListener("change", () => {
        elements.rangePreset.value = "custom";
        renderAll();
    });
}

function saveSettings() {
    const next = {
        calendarUrl: elements.calendarUrl.value.trim(),
        keywordGroups: state.settings.keywordGroups,
    };

    state.settings = next;
    sessionStorage.setItem(
        STORAGE_KEYS.settings,
        JSON.stringify(state.settings),
    );
}

function renderKeywordGroups() {
    const entries = Object.entries(state.settings.keywordGroups);
    elements.keywordGroups.innerHTML = entries
        .map(([group, keywords]) => {
            const chips = keywords
                .map(
                    (keyword) =>
                        `<span class="keyword-chip">${escapeHtml(keyword)} <button type="button" data-remove-group="${escapeHtml(group)}" data-keyword="${escapeHtml(keyword)}">x</button></span>`,
                )
                .join("");

            return `
        <section class="group-card">
          <h3>${escapeHtml(group)}</h3>
          <div class="keyword-list">${chips || '<span class="helper">No keywords yet.</span>'}</div>
          <div class="keyword-input-row">
            <input type="text" data-input-group="${escapeHtml(group)}" placeholder="Add keyword(s): migraine, aura/medication">
            <button type="button" class="small secondary" data-add-group="${escapeHtml(group)}">Add</button>
          </div>
        </section>
      `;
        })
        .join("");
}

function addKeyword(group, rawKeyword) {
    const parsedKeywords = splitKeywords(rawKeyword);
    if (!parsedKeywords.length) return;
    const list = state.settings.keywordGroups[group] || [];
    const existing = new Set(list.map((item) => item.toLowerCase()));

    parsedKeywords.forEach((keyword) => {
        if (!existing.has(keyword.toLowerCase())) {
            list.push(keyword);
            existing.add(keyword.toLowerCase());
        }
    });

    state.settings.keywordGroups[group] = list;
    persistSettings();
    renderKeywordGroups();
}

function removeKeyword(group, keyword) {
    const list = state.settings.keywordGroups[group] || [];
    state.settings.keywordGroups[group] = list.filter(
        (item) => item.toLowerCase() !== keyword.toLowerCase(),
    );
    persistSettings();
    renderKeywordGroups();
}

async function handleCalendarUpdate() {
    saveSettings();
    if (!state.settings.calendarUrl) {
        alert("Please set a calendar URL first.");
        elements.settingsDialog.showModal();
        return;
    }

    elements.updateBtn.disabled = true;
    elements.updateBtn.textContent = "Updating...";

    try {
        const icsUrl = normalizeCalendarUrl(state.settings.calendarUrl);
        const calendarText = await fetchCalendarText(icsUrl);
        const parsedEvents = parseIcsEvents(calendarText);
        const classified = classifyEvents(
            parsedEvents,
            state.settings.keywordGroups,
        );
        replaceDbFromSync(classified);
        renderAll();
        alert(`Update complete: parsed ${classified.length} events.`);
    } catch (error) {
        console.error(error);
        alert(`Calendar update failed: ${error.message}`);
    } finally {
        elements.updateBtn.disabled = false;
        elements.updateBtn.textContent = "Update from Calendar";
    }
}

function replaceDbFromSync(events) {
    state.db.events = events
        .slice()
        .sort(
            (a, b) =>
                b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
        );
    state.db.lastSyncAt = new Date().toISOString();
    sessionStorage.setItem(STORAGE_KEYS.db, JSON.stringify(state.db));
}

function renderAll() {
    const range = getActiveRange();
    const filtered = filterByRange(state.db.events, range);
    renderStats(filtered, range);
    renderDailyChart(filtered, range);
    renderWeeklyChart(filtered, range);
    renderWeekdayChart(filtered);
    renderMonthlyCalendars(filtered, range);
    renderUnrecognizedKeywords(filtered);
    renderAllEventsTable(state.db.events);
}

function renderMonthlyCalendars(events, range) {
    const migraineEvents = events.filter((event) =>
        event.groups.includes("Migraine"),
    );
    const dayCounts = new Map();
    let maxCount = 0;

    migraineEvents.forEach((event) => {
        const next = (dayCounts.get(event.date) || 0) + 1;
        dayCounts.set(event.date, next);
        if (next > maxCount) maxCount = next;
    });

    const months = enumerateMonths(range.start, range.end);
    if (!months.length) {
        elements.monthlyCalendars.innerHTML =
            '<span class="helper">No months in selected range.</span>';
        return;
    }

    elements.monthlyCalendars.innerHTML = months
        .map(({ year, month }) =>
            renderMonthCard(year, month, dayCounts, maxCount),
        )
        .join("");
}

function renderMonthCard(year, month, dayCounts, maxCount) {
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const leadingBlanks = (firstDay.getDay() + 6) % 7;
    const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const title = firstDay.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
    });

    const dayCells = [];
    for (let i = 0; i < leadingBlanks; i += 1) {
        dayCells.push('<div class="day-cell empty"></div>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = dayCounts.get(iso) || 0;
        const intensity = maxCount > 0 ? count / maxCount : 0;
        const color = count > 0 ? migraineDayColor(intensity) : "#ffffff";
        const className = count > 0 ? "day-cell migraine" : "day-cell";
        const badge = count > 0 ? `<span class="badge">${count}</span>` : "";
        dayCells.push(
            `<div class="${className}" style="background:${color}" title="${iso}: ${count} migraine event(s)">${day}${badge}</div>`,
        );
    }

    return `
    <article class="month-card">
      <h3 class="month-title">${escapeHtml(title)}</h3>
      <div class="month-weekdays">${weekdayLabels.map((label) => `<span>${label}</span>`).join("")}</div>
      <div class="month-days">${dayCells.join("")}</div>
    </article>
  `;
}

function migraineDayColor(intensity) {
    const alpha = Math.min(0.15 + intensity * 0.7, 0.85);
    return `rgba(190, 24, 93, ${alpha.toFixed(2)})`;
}

function renderUnrecognizedKeywords(events) {
    const keywords = flattenKeywords(state.settings.keywordGroups);
    const keywordSet = new Set(
        keywords.map((keyword) => keyword.toLowerCase()),
    );
    const counts = new Map();

    events.forEach((event) => {
        const terms = Array.isArray(event.unmatchedTerms)
            ? event.unmatchedTerms
            : extractEventTerms(event.title, "");
        terms.forEach((term) => {
            const normalized = term.toLowerCase();
            if (!normalized || keywordSet.has(normalized)) return;
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        });
    });

    const items = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 60);

    if (!items.length) {
        elements.unrecognizedKeywordsList.innerHTML =
            '<span class="helper">No unrecognized terms in this range.</span>';
        return;
    }

    elements.unrecognizedKeywordsList.innerHTML = items
        .map(
            ([term, count]) =>
                `<span class="keyword-chip plain">${escapeHtml(term)} <span class="count">(${count})</span></span>`,
        )
        .join("");
}

function renderStats(events, range) {
    const migraine = events.filter((event) =>
        event.groups.includes("Migraine"),
    ).length;
    const medication = events.filter((event) =>
        event.groups.includes("Medication"),
    ).length;
    const tracked = events.filter((event) => event.groups.length > 0).length;
    const days = Math.max(1, diffDays(range.start, range.end) + 1);
    const weeks = days / 7;
    const months = days / 30.4375;

    const cards = [
        { label: "Total Migraine", value: migraine },
        { label: "Total Medication", value: medication },
        { label: "Tracked Events", value: tracked },
        { label: "Migraine / Week", value: (migraine / weeks).toFixed(2) },
        { label: "Medication / Week", value: (medication / weeks).toFixed(2) },
        { label: "Tracked / Month", value: (tracked / months).toFixed(2) },
    ];

    elements.statsGrid.innerHTML = cards
        .map(
            (card) =>
                `<article class="stat-card"><div class="label">${card.label}</div><div class="value">${card.value}</div></article>`,
        )
        .join("");
}

function renderDailyChart(events, range) {
    const allDays = enumerateDays(range.start, range.end);
    const migraine = new Map(allDays.map((day) => [day, 0]));

    events.forEach((event) => {
        if (event.groups.includes("Migraine"))
            migraine.set(event.date, (migraine.get(event.date) || 0) + 1);
    });

    const labels = allDays;
    const migraineData = labels.map((day) => migraine.get(day) || 0);

    if (state.dailyChart) state.dailyChart.destroy();
    state.dailyChart = new Chart(elements.dailyChartCanvas, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Migraine",
                    data: migraineData,
                    backgroundColor: "rgba(190, 24, 93, 0.72)",
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 10,
                    },
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                },
            },
        },
    });
}

function renderWeekdayChart(events) {
    const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const migraine = [0, 0, 0, 0, 0, 0, 0];

    events.forEach((event) => {
        const day = new Date(`${event.date}T00:00:00`).getDay();
        if (event.groups.includes("Migraine")) migraine[day] += 1;
    });

    if (state.weekdayChart) state.weekdayChart.destroy();
    state.weekdayChart = new Chart(elements.weekdayChartCanvas, {
        type: "line",
        data: {
            labels: weekdayLabels,
            datasets: [
                {
                    label: "Migraine",
                    data: migraine,
                    borderColor: "#be185d",
                    backgroundColor: "rgba(190,24,93,0.2)",
                    tension: 0.35,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
            },
        },
    });
}

function renderWeeklyChart(events, range) {
    const migraineEvents = events.filter((event) =>
        event.groups.includes("Migraine"),
    );
    const weeks = enumerateWeeks(range.start, range.end);
    const counts = new Map(weeks.map((week) => [week, 0]));

    migraineEvents.forEach((event) => {
        const weekStart = getWeekStartISO(event.date);
        if (counts.has(weekStart)) {
            counts.set(weekStart, (counts.get(weekStart) || 0) + 1);
        }
    });

    const weekMeta = weeks.map((startISO) => {
        const info = getIsoWeekInfo(startISO);
        const endISO = formatDateISO(addDays(startISO, 6));
        return {
            startISO,
            endISO,
            weekLabel: `W${info.week}`,
            year: info.year,
        };
    });
    const labels = weekMeta.map((item) => item.weekLabel);
    const data = weekMeta.map((item) => counts.get(item.startISO) || 0);

    if (state.weeklyChart) state.weeklyChart.destroy();
    state.weeklyChart = new Chart(elements.weeklyChartCanvas, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Migraine",
                    data,
                    borderColor: "#be185d",
                    backgroundColor: "rgba(190,24,93,0.2)",
                    fill: true,
                    tension: 0.3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        title(items) {
                            if (!items.length) return "";
                            const index = items[0].dataIndex;
                            const meta = weekMeta[index];
                            return `Week ${meta.weekLabel} (${meta.startISO} to ${meta.endISO})`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12,
                    },
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                },
            },
        },
    });
}

function getActiveRange() {
    const start = elements.startDate.value;
    const end = elements.endDate.value;
    return {
        start: start || formatDateISO(daysAgo(180)),
        end: end || formatDateISO(new Date()),
    };
}

function applyPreset(preset) {
    const today = new Date();
    let start;
    let end = today;

    if (preset === "last_month") {
        start = daysAgo(30);
    } else if (preset === "last_6_months") {
        start = daysAgo(182);
    } else if (preset === "last_year") {
        start = daysAgo(365);
    } else if (preset === "this_year") {
        start = new Date(today.getFullYear(), 0, 1);
    } else {
        return;
    }

    elements.startDate.value = formatDateISO(start);
    elements.endDate.value = formatDateISO(end);
}

function filterByRange(events, range) {
    return events.filter(
        (event) => event.date >= range.start && event.date <= range.end,
    );
}

function classifyEvents(events, keywordGroups) {
    const normalized = normalizeKeywordGroups(keywordGroups);
    const allKeywords = flattenKeywords(keywordGroups);

    return events.map((event) => {
        const terms = extractEventTerms(event.title, event.description);
        const text = `${event.title} ${event.description || ""}`.toLowerCase();
        const groups = [];
        const matchedKeywords = new Set();

        normalized.forEach(({ group, keywords }) => {
            const groupMatches = keywords.filter((keyword) => {
                if (!keyword) return false;
                if (terms.includes(keyword)) return true;
                if (terms.some((term) => term.includes(keyword))) return true;
                return text.includes(keyword);
            });

            if (groupMatches.length) {
                groups.push(group);
                groupMatches.forEach((keyword) => matchedKeywords.add(keyword));
            }
        });

        const unmatchedTerms = terms.filter(
            (term) => !allKeywords.some((keyword) => term.includes(keyword)),
        );

        return {
            id: event.id || crypto.randomUUID(),
            date: event.date,
            title: event.title,
            originalText: [event.title, event.description]
                .filter(Boolean)
                .join(" | "),
            groups,
            matchedKeywords: Array.from(matchedKeywords),
            unmatchedTerms,
        };
    });
}

function renderAllEventsTable(events) {
    if (!events.length) {
        elements.allEventsTableBody.innerHTML =
            '<tr><td colspan="3" class="helper">No synced events yet.</td></tr>';
        return;
    }

    const rows = events
        .slice()
        .sort(
            (a, b) =>
                b.date.localeCompare(a.date) ||
                (a.title || "").localeCompare(b.title || ""),
        )
        .map((event) => {
            const originalText = event.originalText || event.title || "";
            const categories =
                event.groups && event.groups.length
                    ? event.groups.join(", ")
                    : "Unmatched";
            return `<tr><td>${event.date}</td><td>${escapeHtml(originalText)}</td><td>${escapeHtml(categories)}</td></tr>`;
        })
        .join("");

    elements.allEventsTableBody.innerHTML = rows;
}

function normalizeKeywordGroups(keywordGroups) {
    return Object.entries(keywordGroups).map(([group, keywords]) => ({
        group,
        keywords: keywords
            .flatMap((word) => splitKeywords(word))
            .map((word) => word.toLowerCase()),
    }));
}

function flattenKeywords(keywordGroups) {
    return Object.values(keywordGroups)
        .flatMap((keywords) => keywords.flatMap((word) => splitKeywords(word)))
        .map((word) => word.toLowerCase())
        .filter(Boolean);
}

function extractEventTerms(title, description) {
    const text = `${title || ""},${description || ""}`;
    return splitKeywords(text).map((term) => term.toLowerCase());
}

function splitKeywords(rawText) {
    return String(rawText || "")
        .split(/[,\;/\n]+/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function normalizeCalendarUrl(rawUrl) {
    const url = new URL(rawUrl);

    if (
        url.pathname.endsWith(".ics") ||
        url.pathname.includes("/calendar/ical/")
    ) {
        return url.toString();
    }

    const cid = url.searchParams.get("cid");
    if (!cid) {
        throw new Error(
            "Calendar URL must include `cid` or point directly to an .ics feed.",
        );
    }

    const decodedCid = decodeURIComponent(cid);
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(decodedCid)}/public/basic.ics`;
}

async function fetchCalendarText(sourceUrl) {
    const urls = [
        sourceUrl,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(sourceUrl)}`,
        `https://r.jina.ai/http://${sourceUrl.replace(/^https?:\/\//, "")}`,
    ];

    let lastError = null;

    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const text = await response.text();
            if (!text.includes("BEGIN:VCALENDAR")) {
                throw new Error("Response is not an iCalendar feed");
            }
            return text;
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(
        `Unable to download calendar feed. ${lastError ? lastError.message : ""}`,
    );
}

function parseIcsEvents(icsText) {
    const lines = unfoldIcsLines(icsText);
    const events = [];
    let event = null;

    for (const line of lines) {
        if (line === "BEGIN:VEVENT") {
            event = {};
            continue;
        }
        if (line === "END:VEVENT") {
            if (event && event.date && event.title) events.push(event);
            event = null;
            continue;
        }
        if (!event) continue;

        const separator = line.indexOf(":");
        if (separator < 0) continue;

        const keyPart = line.slice(0, separator);
        const value = line.slice(separator + 1).trim();
        const key = keyPart.split(";")[0];

        if (key === "SUMMARY") event.title = unescapeIcs(value);
        if (key === "DESCRIPTION") event.description = unescapeIcs(value);
        if (key === "UID") event.id = value;
        if (key === "DTSTART") event.date = parseIcsDate(value);
    }

    return events.filter((entry) => entry.date);
}

function unfoldIcsLines(content) {
    const raw = content.replace(/\r/g, "").split("\n");
    const out = [];

    for (const line of raw) {
        if (!line) continue;
        if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
            out[out.length - 1] += line.slice(1);
        } else {
            out.push(line);
        }
    }

    return out;
}

function parseIcsDate(raw) {
    if (/^\d{8}$/.test(raw)) {
        return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }

    const match = raw.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
    );
    if (!match) return null;

    const [, year, month, day, hour, minute, second, utc] = match;
    const date = utc
        ? new Date(
              Date.UTC(
                  Number(year),
                  Number(month) - 1,
                  Number(day),
                  Number(hour),
                  Number(minute),
                  Number(second),
              ),
          )
        : new Date(
              Number(year),
              Number(month) - 1,
              Number(day),
              Number(hour),
              Number(minute),
              Number(second),
          );

    return formatDateISO(date);
}

function unescapeIcs(text) {
    return text
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\n/g, " ")
        .replace(/\\\\/g, "\\");
}

function diffDays(startISO, endISO) {
    const ms =
        new Date(`${endISO}T00:00:00`).getTime() -
        new Date(`${startISO}T00:00:00`).getTime();
    return Math.floor(ms / 86400000);
}

function enumerateDays(startISO, endISO) {
    const days = [];
    const cur = new Date(`${startISO}T00:00:00`);
    const end = new Date(`${endISO}T00:00:00`);

    while (cur <= end) {
        days.push(formatDateISO(cur));
        cur.setDate(cur.getDate() + 1);
    }

    return days;
}

function enumerateMonths(startISO, endISO) {
    const start = new Date(`${startISO}T00:00:00`);
    const end = new Date(`${endISO}T00:00:00`);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const months = [];

    while (cursor <= end) {
        months.push({
            year: cursor.getFullYear(),
            month: cursor.getMonth() + 1,
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

function enumerateWeeks(startISO, endISO) {
    const startWeek = new Date(`${getWeekStartISO(startISO)}T00:00:00`);
    const end = new Date(`${endISO}T00:00:00`);
    const weeks = [];

    while (startWeek <= end) {
        weeks.push(formatDateISO(startWeek));
        startWeek.setDate(startWeek.getDate() + 7);
    }

    return weeks;
}

function getWeekStartISO(dateISO) {
    const date = new Date(`${dateISO}T00:00:00`);
    const shift = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - shift);
    return formatDateISO(date);
}

function addDays(dateISO, days) {
    const date = new Date(`${dateISO}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date;
}

function getIsoWeekInfo(dateISO) {
    const date = new Date(`${dateISO}T00:00:00`);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const week1 = new Date(date.getFullYear(), 0, 4);
    week1.setHours(0, 0, 0, 0);
    const week =
        1 +
        Math.round(
            ((date.getTime() - week1.getTime()) / 86400000 -
                3 +
                ((week1.getDay() + 6) % 7)) /
                7,
        );
    return { year: date.getFullYear(), week };
}

function daysAgo(count) {
    const date = new Date();
    date.setDate(date.getDate() - count);
    return date;
}

function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function persistSettings() {
    sessionStorage.setItem(
        STORAGE_KEYS.settings,
        JSON.stringify(state.settings),
    );
}

function loadJson(key, fallback) {
    try {
        const value = sessionStorage.getItem(key);
        if (!value) return structuredClone(fallback);
        return { ...structuredClone(fallback), ...JSON.parse(value) };
    } catch {
        return structuredClone(fallback);
    }
}

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeCss(input) {
    if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(input);
    }
    return input.replace(/[^a-zA-Z0-9_-]/g, "");
}
