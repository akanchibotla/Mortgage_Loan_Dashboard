# Mortgage Loan Dashboard

Self-updating dashboard comparing **state-level U.S. mortgage rates** with the actual closed-loan distribution from HMDA. Built on Vite + React + TypeScript with Chart.js + D3.

**Live:** https://akanchibotla.github.io/Mortgage_Loan_Dashboard/

Three pages:
- **Home** — U.S. state choropleth colored by current 15-yr / 30-yr Bankrate rate; click any state to drill in.
- **State** (`/state/:slug`) — per-state time-series chart with Freddie PMMS (US), Bankrate state, Mortgage News Daily state, and HMDA 2024 reference band where bundled.
- **Calculator** (`/calculator`) — pick state + term + loan amount; see HMDA p10–p90 rate band, today's quoted market, and monthly P&I at low / central / high rates.

Daily auto-refresh at 12 UTC via GitHub Actions; data is committed back to the repo and re-deployed to Pages.

## State coverage — full national

- **HMDA 2024 distributions + county drilldown: all 51 states** (DC + 50).
- **HMDA demographic breakdowns: all 51 states** — race × ethnicity × sex × loan-amount bracket per 15/30-yr.
- **Live Bankrate + MND daily refresh: all 51 states** (workflow auto-iterates `src/data/states/*`).
- **Wayback historical rate series: 50 states** (one state, DC, has no Wayback Bankrate coverage; some others are sparse).
- 3,141 U.S. counties with HMDA-actual closed-loan distributions; ~7 million originations partitioned.

## Quick start (local)

```
npm install
pip install -r requirements.txt
python -m playwright install chromium
npm run dev
```

Open http://localhost:5173.

## Adding a state

```
python scripts/backfill_bankrate_state_wayback.py --state pennsylvania
python scripts/fetch_bankrate_state.py --state pennsylvania
python scripts/fetch_mnd_state.py --state pennsylvania
python scripts/aggregate_mnd_state.py --state pennsylvania
python scripts/reconcile_state.py --state pennsylvania
python scripts/build_states_index.py
```

Then append `pennsylvania` to `ACTIVE_STATES` in `.github/workflows/refresh.yml`. The daily cron picks it up.

## FRED API key (recommended)

The FRED PMMS fetcher tries the official API at `api.stlouisfed.org` first
when a key is configured, then falls back to the public CSV + HTML
endpoints. The API tier is far more reliable — the public CSV graph
endpoint is currently flaky and the runner sometimes can't reach the HTML
page either, so without a key the dashboard can drift to stale PMMS values.

1. Register a free key: <https://fred.stlouisfed.org/docs/api/api_key.html>
2. Add it as a repo secret named `FRED_API_KEY`
   (Settings → Secrets and variables → Actions → New repository secret)
3. The daily workflow picks it up automatically — no other changes needed

Locally, export `FRED_API_KEY=<your_key>` before running
`python scripts/fetch_fred.py`. If unset, the script skips the API tier and
prints what it tries next; you don't have to delete it.

## Data sources

| Source | Coverage | Refresh |
|---|---|---|
| Freddie Mac PMMS (US 15/30-yr) | [FRED MORTGAGE15US](https://fred.stlouisfed.org/series/MORTGAGE15US) / [MORTGAGE30US](https://fred.stlouisfed.org/series/MORTGAGE30US) | Weekly via `fetch_fred.py` |
| Bankrate state purchase rates | Per-state pages, headless Chromium + Wayback backfill | Daily live + one-shot historical |
| Mortgage News Daily state | Per-state pages, static HTML + Wayback | Daily live + sparse historical |
| HMDA 2024 origination distribution | [FFIEC HMDA LAR](https://ffiec.cfpb.gov/data-browser/), per-state filter (NC only currently — bulk download deferred, see ROADMAP) | Annual |

## File layout

```
src/
  data/                  Chart-ready JSON (committed; auto-refreshed)
    states/{slug}/       Per-state files: bankrate_*, mnd_*, hmda_*, state_meta
    states_index.json    Latest rate per state (powers the choropleth)
    pmms_*_monthly.json  National Freddie series
    window.json          Rolling time window
  chart/                 Chart.js registration + options factory
  components/            RateChart (Chart.js), RateTable, UsChoropleth (D3)
  pages/                 HomePage, StateDashboard, CalculatorPage
  lib/                   loadStateData (lazy per-state JSON loader)
data/daily/              Append-only JSONL accumulators (committed)
scripts/                 Python fetchers + reconcilers + index builder
  _paths.py, _window.py  Shared helpers
  states.py              Canonical 50-state + DC registry
.github/workflows/
  deploy.yml             Build + Pages deploy on push
  refresh.yml            Daily cron: fetch all ACTIVE_STATES, commit
```

## Known limitations

- **HMDA bulk download** is gated behind a JS-rendered FFIEC page; the data-browser API returned 403 to scripted requests. NC HMDA was obtained out-of-band. Per-state HMDA expansion requires the bulk national LAR (~3 GB) or per-state manual exports from the FFIEC browser UI.
- **MND historical via Wayback is sparse** (4–10 snapshots per state in 24 months). Series grows denser via forward daily collection.
- **County drilldown** (v3) is unblocked but requires HMDA bulk first.

## Bundle stats

Main bundle 233 KB / 75 KB gzipped. Chart.js (~260 KB) lazy-loaded per route. Choropleth (~140 KB) lazy-loaded on home only.
