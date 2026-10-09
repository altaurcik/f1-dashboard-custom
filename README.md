# F1 Dashboard Custom

Local Formula 1 Live Timing dashboard. The main view is rebuilt around the layout and presentation
of [Formula 1 Dashboard](https://app.formula1dashboard.com/live-timing/), without its left navigation sidebar.

- Timing and Stints tables, including gaps, intervals, mini-sectors, tyre age and stint history.
- Linked selection of up to two drivers for telemetry and map cameras.
- Smooth real positional data with a two-second presentation buffer; 2D and geographic 3D maps.
- Session best, previous edition, race lap record and overall track record.
- Race Control cards, filters, counters, notifications and optional sound/desktop alerts.
- Team Radio portraits, timestamps and audio playback.
- Three layouts, compact rows, dark/light themes and broadcast delay.

## Run locally

Use Node.js from `.nvmrc` and the Yarn version in `packageManager`.

```powershell
corepack yarn install --immutable
# Only if .env.local does not exist:
Copy-Item .env.example .env.local
```

The default bridge connects directly to Formula 1. Anonymous live topics can be incomplete.
The current local setup still has a reference relay override; independent migration is not complete.
Only free sources are being considered. See [DATA_SOURCES.md](DATA_SOURCES.md) for field coverage,
verified archive access, live limitations and the migration plan.

In two terminals from the project root:

```powershell
node tools/f1-live.cjs
```

```powershell
corepack yarn dev --hostname 127.0.0.1 --port 3000
```

Open [the dashboard](http://127.0.0.1:3000/dashboard).
Without the relay setting, the bridge connects directly to F1; positional/telemetry topics may be absent.
The mock generator is never started as part of this workflow.

## Project documentation

- [AGENTS.md](AGENTS.md): development rules and requirements for updating the project map.
- [PROJECT_MAP.md](PROJECT_MAP.md): architecture, routes, data sources, configuration and limitations.
- [DATA_SOURCES.md](DATA_SOURCES.md): independent sources for every Live Timing field and verification results.

Read-only source verification: `node tools/check-data-sources.cjs .cache/data-source-audit.json`.

The current geographic basemap uses MapLibre/OpenFreeMap. The reference uses Mapbox 3D tiles;
a user's own public Mapbox token is needed for an identical basemap. This difference is not a completed 1:1 match.
The live relay and historical REST API belong to the reference service; their underlying F1 ingestion is not established.
