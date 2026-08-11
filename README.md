# Mortgage Loan Dashboard

Self-updating dashboard comparing **state-level U.S. mortgage rates** with the actual closed-loan distribution from HMDA. Built on Vite + React + TypeScript with Chart.js + D3.

**Live:** https://akanchibotla.github.io/Mortgage_Loan_Dashboard/

Five pages:
- **Home** (`/`) — U.S. state choropleth colored by current 15-yr / 30-yr Bankrate rate; click any state to drill in.
- **State** (`/state/:slug`) — per-state time-series chart with Freddie PMMS (national), Bankrate state, Mortgage News Daily state, NerdWallet state, Rocket (national), and that state's HMDA 2024 reference band.
- **County** (`/state/:slug/county/:fips`) — the county's own HMDA distribution against its state's, plus nearest-peer counties.
- **Calculator** (`/calculator`) — pick state + term + loan amount; see HMDA p10–p90 rate band, today's quoted market, and monthly P&I at low / central / high rates.
- **Methodology** (`/methodology`) — what each series is, how it is collected, and what it does not say.

URLs are hash-based (`…/#/state/california`) — the app uses `HashRouter` so deep links survive a
refresh on GitHub Pages. The trade-off is no per-route search indexing; see `ROADMAP.md` → *Routing*.

Daily auto-refresh at 12 UTC via GitHub Actions; data is committed back to the repo and re-deployed to Pages.

## State coverage — full national

- **HMDA 2024 distributions + county drilldown: all 51 states** (DC + 50).
- **HMDA demographic breakdowns: all 51 states** — race × ethnicity × sex × loan-amount bracket per 15/30-yr.
- **Live Bankrate + MND + NerdWallet daily refresh: all 51 states** (workflow auto-iterates `src/data/states/*`). Two per-source exceptions are coded as known gaps, not failures: Bankrate has **no DC page** (`fetch_bankrate_state.KNOWN_NO_COVERAGE`), NerdWallet has **no Nevada page** (`fetch_nerdwallet_state.KNOWN_NO_COVERAGE`).
- **Wayback historical Bankrate series: 45 states have at least one archived month.** Coverage is uneven — inside the 27-month window (`src/data/window.json`) the archived states carry a median of 14 monthly snapshots (range 10–19); 5 states (Alaska, Arkansas, Delaware, Nevada, New Hampshire) have no backfill file at all. **DC's absence is not a Wayback gap** — Bankrate publishes no DC state page to archive.
- **3,128 U.S. counties** with HMDA-actual closed-loan distributions; **2,904,579 originations** partitioned (2024 LAR, `action_taken=1` + `loan_purpose=1`, stated term of 180 or 360 months, excluding reverse mortgages, open-end lines of credit, business-purpose loans, and rows with no usable rate).

## Quick start (local)

```
npm install
pip install -r requirements.txt
python -m playwright install chromium
npm run dev
```

Open http://localhost:5173.

## Adding a state

All 51 already ship, so this is rare. The full recipe — the short version that used to live
here silently skipped NerdWallet, HMDA, the daily view and the sitemap:

```
SLUG=pennsylvania

# One-shot history (network-heavy; run once, commit the result)
python scripts/backfill_bankrate_state_wayback.py --state $SLUG
python scripts/backfill_nerdwallet_state_wayback.py --state $SLUG

# Live fetchers (these are what the daily cron runs)
python scripts/fetch_bankrate_state.py --state $SLUG
python scripts/fetch_mnd_state.py --state $SLUG
python scripts/fetch_nerdwallet_state.py --state $SLUG

# HMDA — annual, and the ONLY step the cron never runs. Without it the state
# ships with no distribution band, no county drilldown and no demographics.
python scripts/fetch_hmda_state.py --state $SLUG

# Aggregate + reconcile + emit the views
python scripts/aggregate_mnd_state.py --state $SLUG
python scripts/aggregate_nerdwallet_state.py --state $SLUG
python scripts/reconcile_state.py --state $SLUG
python scripts/emit_daily_view.py --state $SLUG

# Rebuild the cross-state artifacts
python scripts/build_states_index.py
python scripts/build_sitemap.py
```

**No workflow edit is needed.** `refresh.yml` discovers states at run time by listing the
directories under `src/data/states/` (`find -mindepth 1 -maxdepth 1 -type d`), so creating the
state's directory is what enrolls it in the daily cron.

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
| Bankrate state purchase rates | Per-state pages, headless Chromium + Wayback backfill (no DC page exists) | Daily live + one-shot historical |
| Mortgage News Daily state | Per-state pages, static HTML + Wayback | Daily live + sparse historical |
| NerdWallet state | Per-state pages, static HTML + Wayback backfill (no Nevada page exists) | Daily live + one-shot historical |
| Rocket Mortgage (national) | `fetch_rocket.py` — **not daily**. Akamai denylists GitHub Actions' datacenter IPs, so CI's attempt fails by design and the feed is refreshed from a residential machine (`scripts/rocket_residential_refresh.ps1`). Observed multi-week gaps. | ~weekly, by hand |
| HMDA 2024 origination distribution | [FFIEC HMDA LAR](https://ffiec.cfpb.gov/data-browser/), per-state CSV export via `fetch_hmda_state.py` — **all 51 states** | Annual |

## File layout

```
src/
  data/                  Chart-ready JSON (committed; auto-refreshed)
    states/{slug}/       Per-state files: bankrate_*, mnd_*, hmda_*, state_meta
    states_index.json    Latest rate per state (powers the choropleth)
    pmms_*_monthly.json  National Freddie series
    window.json          Rolling time window
    topo/{fips}.json     Per-state county geometry (lazy-loaded)
  chart/                 Chart.js registration + options factory
  components/            RateChart, RateTable, UsChoropleth, CountyChoropleth,
                         DemographicsPanel, AmortPanel, ErrorBoundary
  pages/                 HomePage, StateDashboard, CountyDashboard,
                         CalculatorPage, MethodologyPage
  lib/                   loadStateData (lazy per-state JSON loader), payment,
                         loanMath, the calculator/chart/theme hooks
data/daily/              Append-only JSONL accumulators (committed) — see its README
scripts/                 Python fetchers + reconcilers + builders
  _paths.py, _window.py, _http.py   Shared helpers
  states.py              Canonical 50-state + DC registry
  tests/                 pytest suite for the pipeline
.github/workflows/
  deploy.yml             Build + Pages deploy on push
  refresh.yml            Daily cron: discovers states from src/data/states/, fetches, commits
```

## Known limitations

- **Wayback historical depth is uneven.** Bankrate: 45 states have at least one archived month, median 14 in the 27-month window; 5 states have none. MND historical is sparser still. All series grow denser via forward daily collection.
- **Rocket is not on the daily cron** — Akamai blocks the runner's IP, so it is refreshed roughly weekly from a residential machine. Gaps of two weeks and more have occurred; `check_stale_sources.py` flags it past 8 days.
- **HMDA is annual and manual.** `fetch_hmda_state.py` is the only pipeline script the cron never runs; the 2024 LAR is re-ingested once a year. The raw per-state CSVs are gitignored — only the partitioned summaries are committed.
- **Connecticut and Alaska county maps are grey.** `us-atlas` 3.0.1 ships 2017-vintage county geometry, while HMDA 2024 uses CT's 2022 planning regions and AK's post-2019 census areas, so those FIPS have no shape to fill. The distributions are still reachable from the state page's top-county links.

## Bundle stats

Main bundle 233 KB / 75 KB gzipped. Chart.js (~260 KB) lazy-loaded per route. Choropleth (~140 KB) lazy-loaded on home only.
