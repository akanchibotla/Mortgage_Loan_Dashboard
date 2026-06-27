# CLAUDE.md — Mortgage Loan Dashboard

> Project-scoped guide. My global profile (identity, Fall-2027 PhD mission, how to work with me) auto-loads from `~/.claude`, so this file is ONLY this project's specifics.

## What this is

Self-updating, full-stack web dashboard that fuses **live U.S. mortgage rates** (Bankrate, Mortgage News Daily, NerdWallet, Rocket, Freddie PMMS) with **2024 HMDA closed-loan distributions** down to the **county** level, plus a borrower payment / buydown calculator.

- **Live:** https://akanchibotla.github.io/Mortgage_Loan_Dashboard/
- **Scale:** all **51** states (50 + DC), **~3,141 counties**, **~7M** HMDA originations partitioned.
- **Pages:** Home (US choropleth) · State (`/state/:slug`) · County (`/county/...`) · Calculator (`/calculator`) · Methodology.
- **Self-healing daily cron** (12 UTC) scrapes every state, commits refreshed data, redeploys Pages, and **opens a GitHub issue when a scheduled run fails** so a silent overnight break doesn't go unnoticed.

## Mission fit

**Off-mission.** This is strong **software-engineering / data-pipeline / CI-CD** evidence — real scraping, streaming aggregation of millions of rows, self-healing automation, full-stack delivery — but it has **zero in-domain physics / aero / astro content**. On its own it reads "capable engineer, wrong field" to an astro/aero admissions committee.

- **Role in the application:** a **1–2 line engineering-platform credential** in the SOP/CV ("built and operate a self-updating national data pipeline + dashboard"). Never a centerpiece.
- **Directive: maintenance mode.** Do **not** extend this for the PhD. Don't add features, states, or sources for portfolio reasons — that time belongs to in-domain artifacts. Touch it only to keep the cron green or fix a real break.

## Status & maturity

Mature and shipping. Architecture is proven end-to-end; "adding a state" is a scripted, no-code-change task. Daily refresh is live and monitored.

**README / ROADMAP are STALE — do not trust them; trust the repo.** Concrete drift to fix or ignore:
- README data-sources table says HMDA is **"NC only currently"** — false. All **51 states** have HMDA distributions + demographic breakdowns, and county drilldown spans the nation. (`src/data/states/` has 51 dirs.)
- ROADMAP says **"12 states bundled" / "12 / 51 in progress"** and Wayback "12 states" — false. All 51 ship.
- README data-sources table **omits NerdWallet and Rocket**, which the daily workflow actually fetches/aggregates (`scripts/fetch_nerdwallet_state.py`, `fetch_rocket.py`, and their `aggregate_*`).
- If you edit docs at all, correct these claims rather than echo them. (Low priority — maintenance mode.)

## Stack & layout

**Frontend:** Vite + React 19 + TypeScript + Chart.js 4 + `react-chartjs-2` + D3 (`d3-geo`, `topojson-client`, `us-atlas`) + `react-router-dom` 7.

**Data/backend:** Python + Playwright (headless Chromium scraping) + Wayback backfill + FRED API (PMMS) + streaming HMDA aggregation. Runtime deps in `requirements.txt` (`playwright`, `openpyxl`).

**CI/CD:** GitHub Actions — `deploy.yml` (build + Pages on push), `refresh.yml` (daily cron, per-source failure tracking, auto-issue on cron failure).

```
src/
  data/states/{slug}/   Per-state chart-ready JSON (committed, auto-refreshed):
                        bankrate_*, mnd_*, hmda_*, state_meta
  data/states_index.json  Latest rate per state (powers choropleth + dropdown)
  data/pmms_*_monthly.json  National Freddie series
  chart/                Chart.js registration + options factory
  components/           RateChart, RateTable, UsChoropleth (D3)
  pages/                HomePage, StateDashboard, CountyDashboard,
                        CalculatorPage, MethodologyPage
  lib/                  loadStateData (lazy per-state JSON loader)
data/daily/             Append-only JSONL accumulators (committed)
scripts/                Python fetchers + reconcilers + builders
  states.py             Canonical 50-state + DC registry (FIPS/slug/name)
  _paths.py _window.py _http.py   Shared helpers
  fetch_/backfill_/aggregate_*    Per-source pipelines (bankrate, mnd,
                                  nerdwallet, rocket, fred, hmda)
  partition_hmda_counties.py, build_states_index.py, reconcile_state.py
.github/workflows/      deploy.yml, refresh.yml
```

## How to run / work on it

```bash
npm install
pip install -r requirements.txt
python -m playwright install chromium
npm run dev          # http://localhost:5173
```

Other scripts: `npm run build` (tsc + vite), `npm run lint`, `npm test` (vitest).

**Add a state** (rarely needed — all 51 already ship):
```bash
python scripts/backfill_bankrate_state_wayback.py --state <slug>
python scripts/fetch_bankrate_state.py --state <slug>
python scripts/fetch_mnd_state.py --state <slug>
python scripts/aggregate_mnd_state.py --state <slug>
python scripts/reconcile_state.py --state <slug>
python scripts/build_states_index.py
# then add <slug> to ACTIVE_STATES in .github/workflows/refresh.yml
```

**Gotchas:**
- **FRED key:** set repo secret `FRED_API_KEY` (and `export FRED_API_KEY=...` locally). Without it the PMMS public-CSV/HTML fallbacks are flaky and rates can go stale.
- Scrapers are **brittle by nature** — Bankrate/MND/NerdWallet/Rocket page changes break fetchers. The cron auto-opens an issue when that happens; that's the signal to look.
- HMDA raw national LAR (~3 GB) is **gitignored**; only partitioned per-state/county summaries are committed.

## Next milestones (maintenance only)

- Keep the daily cron green; respond to auto-opened failure issues.
- (Optional, low value) Reconcile README/ROADMAP with reality per the staleness notes above.
- **No feature work for the PhD.** If tempted to extend this, redirect that effort to an in-domain (astro/aero/physics) computational artifact instead.

## Known gaps / risks

- **Stale docs** (README/ROADMAP) understate actual coverage — see above.
- **Scraper fragility** against upstream HTML changes; Wayback historical depth is uneven across states (some sparse; DC has no Wayback Bankrate).
- **Single-maintainer, hosted entirely on free tiers** (GitHub Actions quota, Pages, FRED). Fine for a portfolio credential; not a system to keep investing in.
