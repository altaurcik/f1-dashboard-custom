# F1 Dashboard Custom

Local Formula 1 Live Timing dashboard. The main view is rebuilt around the layout and presentation
of [Formula 1 Dashboard](https://app.formula1dashboard.com/live-timing/), without its left navigation sidebar.

- Timing and Stints tables, including gaps, intervals, mini-sectors, tyre age and stint history.
- Linked selection of two drivers for pace comparison and map cameras.
- Smooth real positional data with a two-second presentation buffer; 2D and geographic 3D maps.
- Driver comparison: timing gap, closing trend, recent 3/5/10 laps and a conditional catch estimate.
- Race Control cards, filters, counters, notifications and optional sound/desktop alerts.
- Team Radio portraits, timestamps and audio playback.
- Three layouts, compact rows, dark/light themes and broadcast delay.

Driver comparison collects lap history while the dashboard is open. Pit/out laps, cautions and
deleted times are excluded from average pace. A race chase verdict needs at least 30 seconds
of fresh gap updates; qualifying/practice show lap-time comparisons instead.

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

## Local Team Radio transcripts and speakers

Use Python 3.12 and install the complete local runtime once:

```powershell
py -3.12 -m venv .venv-whisper
.\.venv-whisper\Scripts\python.exe -m pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
.\.venv-whisper\Scripts\python.exe -m pip install -r tools/whisper-requirements.txt
```

On Linux/macOS, use python3 -m venv .venv-whisper and .venv-whisper/bin/python.
If Python is elsewhere, set WHISPER_PYTHON to its executable in .env.local.
Restart Next.js after changing environment settings.

Recognition uses faster-whisper medium.en on CPU/int8. Acoustic speaker separation uses the public
[SpeechBrain ECAPA-TDNN model](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb),
with a pinned revision and Apache-2.0 license. Both run locally after the initial weight download.
HF_TOKEN, pyannote, a paid service and a system FFmpeg installation are not required.
Speaker separation is enabled by default; WHISPER_DIARIZE=0 disables it for diagnostics only.
WHISPER_MAX_SPEAKERS defaults to 2 without forcing a second voice; WHISPER_SPEAKER_THRESHOLD
controls cosine-distance clustering (default 0.4).

The latest five Team Radio recordings are transcribed automatically; older cards have a Transcribe
button. Failed jobs offer Retry transcript. Both client and server serialize jobs and reuse cached text.
Audio playback remains available independently. Speaker 1/2 denote acoustic groups within one
recording; they do not identify a driver or engineer. Speaker boundaries are approximate, and short,
noisy or overlapping speech can be misclassified. Saved HF credentials are server-only and are
excluded from the active recognition process.

Status: GET /api/radio-transcript. Regression checks:

```powershell
node tools/test-radio-transcription.cjs
.\.venv-whisper\Scripts\python.exe tools/test_radio_diarization.py
```
