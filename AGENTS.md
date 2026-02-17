# MigraineCalendarAnalytics Agent Notes

## Project Scope
- This repo contains a browser-only static app with three files:
  - `index.html`
  - `main.css`
  - `main.js`
- The app loads a **public Google Calendar URL**, parses calendar events, classifies them by keyword groups (`Migraine`, `Medication`), and visualizes stats/charts.

## Runtime + Libraries
- No build step.
- Use CDN scripts only (currently Chart.js).
- Keep JavaScript framework-free unless explicitly requested.

## Storage Contract
- Persist all user data in `sessionStorage`.
- Current keys:
  - `mca_settings`
  - `mca_db`
- Keep stored values as JSON objects.

## Functional Requirements to Preserve
- Settings modal auto-opens on first run when no calendar URL exists.
- User can manage multiple keywords per group (add/remove).
  - Settings input supports adding multiple keywords at once via `,`, `;`, or `/`.
- `Update from Calendar` fetches calendar data, parses events, classifies against keywords, and stores merged results in DB.
  - Sync behavior is a full refresh: replace local DB events with the latest parsed calendar events each update.
- Main dashboard includes:
  - Date range filter with presets and custom range
  - Daily migraine/medication chart
  - Weekday distribution chart
  - Monthly migraine calendar heatmaps (one per month in selected range)
  - Unrecognized keyword list (terms found in calendar entries but not matched by configured keywords)
  - Full event listing with date, original text, and parsed categories
  - Stats (totals and averages)

## Coding Style
- Keep HTML/CSS/JS clean and readable.
- Prefer small, pure helper functions in `main.js`.
- Avoid introducing build tooling or heavy dependencies for simple UI logic.
- Preserve responsive behavior for desktop and mobile.
