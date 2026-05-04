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

The dashboard expects schema version `2` data.

`data\summary.json` contains the overview payload:

- asset name and latest result date;
- active or archived state;
- canonical build mode;
- per-platform performance summaries;
- P50 build times;
- regression percentages;
- recent and baseline sample counts;
- pass rates;
- compact sparkline values.

`data\aggregated\<asset>.json` contains the full history for one asset. Each record includes run metadata such as date, scenario, CI build number, branch, run reason, machine ID, timestamp, and a `results` object with measured values such as:

- `build-time`;
- `evaluation-time`;
- `evaluation-time-pass*`;
- `exit-code`;
- MSBuild, SDK, ASP.NET Core, and runtime versions;
- test asset, scenario, and app metadata.

Machine IDs ending in `WIN` are treated as Windows, IDs ending in `LIN` are treated as Linux, and missing or unrecognized IDs are shown as historical or unknown-platform data.
