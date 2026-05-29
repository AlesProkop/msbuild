# MSBuild PerfStar Dashboard

Static dashboard for tracking MSBuild PerfStar CI performance over time.

[Open the live dashboard](https://alesprokop.github.io/msbuild/)

The dashboard visualizes benchmark results for MSBuild scenarios across assets, platforms, and build modes. It is hosted as a static GitHub Pages site.

## What it shows

- Cross-asset overview of incremental build performance.
- Per-platform Windows and Linux trends.
- Standard vs multithreaded build comparisons when MT data is available.
- Build and evaluation-time charts for individual scenarios.
- Pass/fail health tracking by scenario and platform.
- Links from chart points to related MSBuild, SDK, and runtime versions when version metadata is available.

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html` | Main dashboard UI and client-side JavaScript. |
| `style.css` | Dashboard styling. |
| `data\summary.json` | Precomputed overview data used by the Overview tab. |
| `data\manifest.json` | Asset manifest with scenario lists and date ranges. |
| `data\aggregated\*.json` | Per-asset result history used by Trends and Health tabs. |
| `data\<date>\<machine>\*.json` | Raw PerfStar CI result files, grouped by run date and machine ID. |
| `.nojekyll` | Keeps GitHub Pages from running Jekyll processing. |

## Running locally

Serve the repository root with any static HTTP server, then open the local URL in a browser.

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not rely on opening `index.html` directly from the file system. The dashboard loads JSON with `fetch()`, and browsers commonly block those requests for `file://` pages.

## Data model

The dashboard expects schema version `3` data and falls back gracefully when
served against schema version `2` (warm fields are simply treated as missing,
so the Overview defaults to ❄ Cold and warm options stay hidden).

`data\summary.json` contains the overview payload:

- asset name and latest result date;
- active or archived state;
- multithreaded scenario availability; assets without MT scenarios are treated as archived in the dashboard views;
- canonical build mode;
- per-platform performance summaries;
- P50 build times;
- regression percentages;
- recent and baseline sample counts;
- pass rates;
- compact sparkline values;
- warm-build summaries, when available (see "Warm vs cold builds" below).

`data\aggregated\<asset>.json` contains the full history for one asset. Each record includes run metadata such as date, scenario, CI build number, branch, run reason, machine ID, timestamp, and a `results` object with measured values such as:

- `build-time`;
- `evaluation-time`;
- `evaluation-time-pass*`;
- `exit-code`;
- `build-time-first` and `evaluation-time-first` for warm scenarios (see "Warm vs cold builds" below);
- MSBuild, measured SDK, ASP.NET Core, and runtime versions;
- test asset, scenario, and app metadata.

Machine IDs ending in `WIN` are treated as Windows, IDs ending in `LIN` are treated as Linux, and missing or unrecognized IDs are shown as historical or unknown-platform data.

## Warm vs cold builds

Cold scenarios (`*-inc-build-*`, `*-rebuild-*`) run with `/nr:false`, so every measured iteration spawns fresh MSBuild worker nodes. The `build-time` metric is the canonical mean across all iterations.

Warm scenarios (`*-warm-inc-build-*`, `*-warm-rebuild-*`, `*-warm-restore-*`) keep MSBuild nodes alive between iterations. The first measured iteration (iteration 0) is systematically different from the rest because in-memory caches have only ever seen the priming build's state. To keep the published mean honest, perfstar emits two parallel metric keys for warm scenarios:

| Metric key | Population | Used by the dashboard |
| --- | --- | --- |
| `build-time` / `evaluation-time` | iterations 1..N-1 (steady state) | Yes — drives all `*Warm` summary slots and trend lines. |
| `build-time-first` / `evaluation-time-first` | iteration 0 only | Diagnostic only — surfaced in the Trends tab via a 🔥 dropdown option, never aggregated into summaries. |
| `exit-code` | all iterations | Yes — drives Health pass rate. Not split, so iteration-0 failures still get caught by validation. |

In `data\summary.json`, warm summaries live in parallel fields next to the cold ones:

```jsonc
{
  "name": "orchard-core",
  "canonical": "standard",
  "canonicalThermal": "cold",     // "cold" by default; "warm" if a project is warm-canonical
  "hasMt": true,
  "hasWarm": true,                 // gates the 🔥 warm chip and warm dropdown options
  "incBuild":     { /* cold */ },
  "rebuild":      { /* cold */ },
  "incBuildWarm": { /* aggregated from results["build-time"] of *-warm-inc-build-* scenarios */ },
  "rebuildWarm":  { /* same, for *-warm-rebuild-* */ },
  "platforms": {
    "windows": { "incBuild": {...}, "rebuild": {...}, "incBuildWarm": {...}, "rebuildWarm": {...} },
    "linux":   { /* same shape */ }
  }
}
```

Rules for the aggregator that builds `summary.json`:

- Warm sparklines and P50s come from `results["build-time"]` only — never `build-time-first`.
- If a warm scenario has no samples in the time window, the matching `*Warm` field should be `null` (the dashboard renders an em-dash).
- The regression banner on the Overview tab is intentionally cold-anchored so warm/cold baselines don't get mixed in attention-grabbing alerts.

In the Overview tab, a `[❄ Cold] [🔥 Warm] [Both]` segmented toggle controls which numbers and sparklines populate the table. The user's preference is persisted to `localStorage`. The default mode is `Cold`, so users without warm data see no visual change.
