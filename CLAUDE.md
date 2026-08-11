# CLAUDE.md — Mortgage Loan Dashboard

> Project-scoped guide. My global profile (identity, Fall-2027 PhD mission, how to work with me) auto-loads from `~/.claude`, so this file is ONLY this project's specifics.

## What this is

Self-updating, full-stack web dashboard that fuses **live U.S. mortgage rates** (Bankrate, Mortgage News Daily, NerdWallet, Rocket, Freddie PMMS) with **2024 HMDA closed-loan distributions** down to the **county** level, plus a borrower payment / buydown calculator.

- **Live:** https://akanchibotla.github.io/Mortgage_Loan_Dashboard/
- **Scale:** all **51** states (50 + DC), **3,128 counties**, **2,904,579** HMDA originations partitioned. *(Both measured off the committed data — sum of `n_loans` across `src/data/states/*/hmda_2024_*yr.json` and the distinct FIPS in `src/data/states/*/counties.json`. Re-derive before quoting them anywhere; they were wrong by 2.4× for months.)*
- **Pages:** Home (US choropleth) · State (`/state/:slug`) · County (`/county/...`) · Calculator (`/calculator`) · Methodology.
- **Self-healing daily cron** (12 UTC) scrapes every state, commits refreshed data, redeploys Pages, and **opens a GitHub issue when a scheduled run fails** so a silent overnight break doesn't go unnoticed.

## Mission fit

**Off-mission.** This is strong **software-engineering / data-pipeline / CI-CD** evidence — real scraping, streaming aggregation of millions of rows, self-healing automation, full-stack delivery — but it has **zero in-domain physics / aero / astro content**. On its own it reads "capable engineer, wrong field" to an astro/aero admissions committee.

- **Role in the application:** a **1–2 line engineering-platform credential** in the SOP/CV ("built and operate a self-updating national data pipeline + dashboard"). Never a centerpiece.
- **Directive: maintenance mode.** Do **not** extend this for the PhD. Don't add features, states, or sources for portfolio reasons — that time belongs to in-domain artifacts. Touch it only to keep the cron green or fix a real break.

## Status & maturity

Mature and shipping. Architecture is proven end-to-end; "adding a state" is a scripted, no-code-change task. Daily refresh is live and monitored.

**Reading the daily commit subject.** It should be a bare `auto: refresh data <date>`. Every daily commit used to carry `(partial: 1 failure(s))` — always `rocket`, always by design (Akamai blocks the runner) — which saturated the signal so completely that a genuine second failure (`nerdwallet:maine`, 2026-07-31) was indistinguishable from noise and permanently lost that state a day. `refresh.yml` now splits the failure log against a hardcoded `EXPECTED_FAILURES` allowlist: expected components stay visible in the step summary as `known-expected: rocket` but no longer tag the subject, and anything else appends `(FAILED: <component>)` and raises `::error::`. **So: a tagged subject now means a real, named regression — go look.**

**README / ROADMAP were rewritten against reality in the 2026-08 truth pass** — the NC-only / 12-state / "HMDA blocked by 403" claims are gone, NerdWallet and Rocket are documented, and the hero counts are the measured ones. Trust them again, but keep the habit that made the drift visible: **verify a number off the committed data before you quote it.**

Failure modes worth remembering, because they will recur:
- The docs lagged reality by *months* while the pipeline kept shipping. Nothing in CI compared prose to data; nothing does now either.
- The published county / origination counts (`3,141` / `~7M`) were never derived — they were plan-era estimates that outlived the plan by 2.4×.
- HMDA's "403 to scripted requests" was diagnosed as an anti-scraping block for a year. It was a `urllib` redirect-header bug; shelling out to `curl` fixed it (`fetch_hmda_state.py:52-54`).

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

Other scripts: `npm run build` (tsc + vite), `npm run lint` (eslint flat config, `eslint.config.js`), `npm run typecheck`, `npm test` (vitest), `python -m pytest scripts/tests -q` (pipeline).

**Use `npm run typecheck`, never a bare `npx tsc --noEmit`.** The root `tsconfig.json` is a solution
file — `"files": []` plus two project references — so `npx tsc --noEmit` type-checks **zero files**
and exits 0. That is a false green, and it read as a passing gate for months. The script is
`tsc -b --noEmit`, which builds through the references and actually checks `src/`.

**Add a state** (rarely needed — all 51 already ship):
```bash
# One-shot history
python scripts/backfill_bankrate_state_wayback.py --state <slug>
python scripts/backfill_nerdwallet_state_wayback.py --state <slug>
# Live fetchers (what the cron runs)
python scripts/fetch_bankrate_state.py --state <slug>
python scripts/fetch_mnd_state.py --state <slug>
python scripts/fetch_nerdwallet_state.py --state <slug>
# HMDA — annual, and the ONE step the cron never runs. Skip it and the state
# ships with no distribution band, no counties and no demographics.
python scripts/fetch_hmda_state.py --state <slug>
# Aggregate + reconcile + emit
python scripts/aggregate_mnd_state.py --state <slug>
python scripts/aggregate_nerdwallet_state.py --state <slug>
python scripts/reconcile_state.py --state <slug>
python scripts/emit_daily_view.py --state <slug>
# Cross-state artifacts
python scripts/build_states_index.py
python scripts/build_sitemap.py
```
**No workflow edit.** `refresh.yml` discovers states at run time by listing the directories under
`src/data/states/` — creating the directory is what enrolls the state. (There is no `ACTIVE_STATES`
variable; the docs claimed one for months after it was removed.)

**Gotchas:**
- **FRED key:** set repo secret `FRED_API_KEY` (and `export FRED_API_KEY=...` locally). Without it the PMMS public-CSV/HTML fallbacks are flaky and rates can go stale.
- Scrapers are **brittle by nature** — Bankrate/MND/NerdWallet/Rocket page changes break fetchers. The cron auto-opens an issue when a run *fails*; a whole source going silently dark (job still green) is caught by the **stale-source backstop** below.
- HMDA raw national LAR (~3 GB) is **gitignored**; only partitioned per-state/county summaries are committed.

**Rocket feed keepalive (why it's special):** Akamai denylists GitHub Actions' datacenter IPs, so the cron's Rocket tiers all 403 (the feed froze 2026-06-03→07-05). From a **residential IP** the same `scripts/fetch_rocket.py` succeeds on Tier 1 (plain urllib, no browser). So Rocket is refreshed from Arun's own machine:
- `scripts/rocket_residential_refresh.ps1` — pulls, runs `fetch_rocket.py` + `aggregate_rocket.py`, and commits/pushes **only** the Rocket data files (idempotent-by-date, pull-rebase push, no `gh`/deploy needed — the daily cron carries it live).
- `scripts/register-rocket-task.ps1` — registers a weekly Windows Scheduled Task (`-StartWhenAvailable`, so a device that was off just runs it on next wake). **Per-device, run once** — the task is OS-local and does *not* sync with git; the runner script does.
  - **The task is weekly and must stay weekly.** This line used to read "only one device's task needs to fire per calendar month," reasoning from the monthly aggregator's need for ≥1 row/month. That reasoning ignored the alarm: `check_stale_sources.py` trips Rocket at **8 days** (`--daily-threshold-days`, default 8, line 217). A monthly cadence therefore keeps a `stale-source` issue lit roughly three weeks in four, which is exactly how the alarm got tuned out. Live proof at the time of writing: `data/daily/rocket.jsonl` runs 07-05 → 07-12 → 07-19 → 07-27 → **08-10** — one 14-day gap, one open issue.
  - So: **≥1 successful run every 7 days.** Extra devices are harmless redundancy and are the cheapest insurance against one machine being off for a fortnight.
- The cron keeps its Playwright (Tier 2) + widened 45-day Wayback (Tier 3) fallbacks, so if archive.org ever snapshots the page, the cron self-heals without the residential task.

**Stale-source backstop:** `scripts/check_stale_sources.py` (run by `refresh.yml`) flags a source only when its *freshest* observation across all states is past threshold — i.e. the whole source is down, not one flaky state — and opens a de-duplicated `stale-source` issue. This is the long-silence alarm the fail-soft design otherwise lacks (a permanently-broken component keeps the job green, so it used to hide for weeks in "(partial)" commit tags).

## Next milestones (maintenance only)

- Keep the daily cron green; respond to auto-opened failure issues.
- Keep the Rocket residential task firing **at least weekly** (see the keepalive note above) — a monthly cadence guarantees an open `stale-source` issue.
- **No feature work for the PhD.** If tempted to extend this, redirect that effort to an in-domain (astro/aero/physics) computational artifact instead.

## Known gaps / risks

- **Scraper fragility** against upstream HTML changes; Wayback historical depth is uneven across states — 45 states have at least one archived Bankrate month (median 14 in the 27-month window), 5 have none. **DC is not a Wayback gap: Bankrate publishes no DC state page at all** (`fetch_bankrate_state.KNOWN_NO_COVERAGE`), and NerdWallet has none for Nevada.
- **CT and AK county maps are grey** — `us-atlas` 3.0.1 ships 2017 geometry; CT's 2022 planning regions match 0 of 9 shapes, AK's census areas 25 of 27. Distributions are correct and still reachable via the state page's top-county links.
- **Single-maintainer, hosted entirely on free tiers** (GitHub Actions quota, Pages, FRED). Fine for a portfolio credential; not a system to keep investing in.
