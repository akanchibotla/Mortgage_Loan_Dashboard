# Roadmap — Mortgage Rate Insight, by State and County

## Vision

> **For any U.S. county, show what borrowers actually paid in 2024 (HMDA) alongside what lenders are quoting today (Bankrate, MND), and let any borrower see where they would fall in that distribution.**

The unique value is the **combination**. Bankrate and Zillow have today's quoted rates per state but no closed-loan reality. The FFIEC HMDA Data Browser has actual closings per county but no time series and no quote comparison. The calculator that asks "based on your loan amount, where do you sit?" doesn't exist in a polished form anywhere. We're building the missing connective tissue.

## Current state — v1 (shipped 2026-06-01)

- NC-only dashboard at https://akanchibotla.github.io/Mortgage_Loan_Dashboard/
- Two charts (15-yr, 30-yr) with FRED PMMS (national), Bankrate NC, Mortgage News Daily NC, and an HMDA 2024 NC 15-yr p10–p90 reference band
- Daily auto-refresh via GitHub Actions cron; rolling window starting Jun 2024
- Pipeline: `scripts/_window.py`, `scripts/_paths.py`, headless-Chromium Bankrate fetcher, Wayback backfill, JSONL accumulators

This proves the data plumbing. Every later phase reuses it.

---

## v2 — National time series (50 states)

**Why first**: scope-up before depth-down. Once Bankrate/MND can be fetched per state with the same pipeline, every later phase trivially generalizes.

### Deliverables
- Per-state daily JSONL: `data/daily/bankrate_{state}.jsonl`, `data/daily/mnd_{state}.jsonl`
- Per-state monthly chart-ready JSON: `data/states/{state}/bankrate_{15,30}yr.json`, `data/states/{state}/mnd_{15,30}yr.json`
- Per-state HMDA 2024 summary: `data/states/{state}/hmda_2024_{15,30}.json` (now 30-yr too, since this is the headline term in most states)
- New route: `/state/:slug` → existing dashboard, parameterized
- State picker on home page (alphabetical dropdown + a US choropleth as visual entry — see v5)
- 50-state Wayback backfill of Bankrate state pages (one-shot, run locally; commit results)

### Hard problems
- **Wayback coverage is uneven across states.** California / Texas / New York are crawled often; Wyoming and the Dakotas may have <5 snapshots in 2 years. v2 must render gracefully when a state's NC line is mostly null.
- **HMDA bulk download is ~3 GB nationally for 2024.** Strategy: download once locally, partition by `state_code`, commit per-state summary JSON, gitignore the raw CSV.
- **Daily refresh runtime balloons.** 50 Bankrate headless fetches × ~20s = ~17 min on each cron run. Mitigations: parallelize 5-at-a-time in Playwright, or stagger across multiple workflows (e.g., regions on different schedules), or accept ~20-min runtime (still well under Action quotas).
- **Bankrate may rate-limit aggressive crawling.** Add randomized delay 5–15s between state fetches; cap to once-per-day; cache state slugs.
- **State slugs in URLs**: Bankrate uses `north-carolina`, MND uses `north-carolina`, so both normalize to lowercase-hyphenated. FIPS state code (`37` for NC) is the canonical key in code; slug is the URL display.

### Files
- `scripts/states.py` — canonical `STATES` list: `[{fips, slug, name}]` for all 50 + DC.
- `scripts/fetch_bankrate_state.py` — generalized version of current Bankrate fetcher, takes state slug.
- `scripts/fetch_mnd_state.py` — same for MND.
- `scripts/backfill_bankrate_state_wayback.py` — one-shot per-state Wayback bulk.
- `scripts/partition_hmda.py` — splits the national HMDA LAR into 51 per-state summaries.
- `src/pages/StateDashboard.tsx` — current `App.tsx` content, props-driven on state.
- `src/router.tsx` — React Router setup with `/` and `/state/:slug`.

### Definition of done
- Picking any state from the dropdown loads `/state/:slug` and shows a working dashboard with whatever data exists for that state. States with sparse Wayback data still render (mostly gap, but render).

---

## v3 — County-level HMDA depth (the differentiator)

**Why next**: this is the actual market gap. Nobody shows per-county 2024 origination distributions in a clean UI. Bankrate/MND don't go below state. The closer we get to "your specific county", the more useful.

### Deliverables
- Per-county HMDA aggregate JSON per state: `data/states/{state}/counties.json` with one entry per county containing `{fips, name, n_loans_15, n_loans_30, distribution_15: {mean, weighted_mean, p10/25/50/75/90}, distribution_30: {...}}`
- Min-n threshold: counties with <30 originations in a term are flagged `low_n: true`; UI shows their distribution with a "small sample" caveat rather than hiding them
- New route: `/state/:slug/county/:fips` (or `:slug` for a county)
- County picker within state-dashboard page: searchable list of counties for that state, with population/n_loans badges
- Per-county chart: same time-series chart (rates aren't per-county, that data doesn't exist) + per-county HMDA distribution band that **replaces** the state-level HMDA band; the contrast between state band and county band is the value
- "Counties most different from state average" leaderboard per state (interesting hook for high/low-rate counties)

### Hard problems
- **HMDA loan_term coverage**: ~85% of loans are 30-yr (loan_term=360), ~5% are 15-yr (180), the rest are other. Per-county 15-yr sample sizes will be tiny in many counties. 30-yr is the headline; 15-yr is a "where data permits" overlay.
- **County FIPS + name + state**: standard 5-digit FIPS (first 2 = state, last 3 = county). We need a canonical lookup file. Census Bureau publishes this as a CSV.
- **Geographic ambiguity**: independent cities in VA (Richmond, Norfolk, etc.) are separate FIPS from surrounding counties; some HMDA rows code these inconsistently. Use FFIEC's canonical mapping.
- **Privacy minimum**: HMDA public LAR excludes some loans for privacy. The "public" version may understate small-county volume by ~5%. Document this; don't chase to perfect.

### Files
- `scripts/partition_hmda_county.py` — extends `partition_hmda.py` to also emit per-county aggregates.
- `scripts/county_metadata.py` — FIPS-to-name lookup from Census.
- `src/pages/CountyDashboard.tsx` — county view.
- `src/components/HmdaBandSelector.tsx` — toggle between state-level and county-level band.

### Definition of done
- Picking any of ~3,143 counties shows that county's distribution next to its state's; comparable stats and visual band.

---

## v4 — Borrower calculator (the activation surface)

**Why fourth**: with state + county data plumbed, the calculator is a thin layer on top. It's the page that converts a passive viewer into a person who *learned something*.

### Deliverables
- New route: `/calculator` (also reachable as a panel on any state/county page)
- Inputs:
  - State (required) — defaults from URL if landed on a state page
  - County (optional)
  - Loan term (15 / 30, default 30)
  - Loan amount (slider + numeric input, default = local median)
  - Optional: credit-score bucket (excellent / good / fair) — mapped to HMDA's `applicant_credit_score_type` filter where present
  - Optional: down payment % (just affects monthly-payment math, not rate lookup)
- Outputs:
  - **Where you sit**: "Based on 2024 HMDA closings in [Wake County, NC], your loan size puts you near the p55 (median). Borrowers with similar loans got rates between 5.6% and 6.8%."
  - **Today's market**: "Currently, Bankrate quotes 5.79% and MND shows 6.09% for NC 15-yr. The historic distribution suggests you should be quoted between 5.50% and 6.40%."
  - **Payment range**: monthly P&I at p10, median, p90 of likely rate range, for the loan amount
  - **Rate-vs-loan-amount curve from HMDA**: scatter of NC 2024 originations with regression line, your dot highlighted
- ZIP-code entry as a shortcut: ZIP → county FIPS via HUD crosswalk → autofill state/county

### Hard problems
- **Loan-size buckets vs continuous lookup**: HMDA bins amounts at $10K intervals. Map the borrower's exact loan amount to the nearest bucket; show what borrowers in that bucket got.
- **Credit-score data is sparse in public HMDA**: `credit_score_type` is reported but the actual score is binned (`9999` = NA, otherwise a coarse range). Use as a soft filter where present, not a hard requirement.
- **Rate-quote bias**: today's Bankrate/MND quotes aren't conditioned on credit, LTV, or loan amount. Be honest in copy: "You'll likely be quoted within ~50 bp of the headline depending on your credit profile."

### Files
- `src/pages/Calculator.tsx`
- `src/calc/hmda_lookup.ts` — given (state, county, term, loan_amount, credit_bucket), return matching HMDA percentiles.
- `src/calc/payment.ts` — standard P&I math.
- `data/zip_to_county.json` — HUD ZIP→county crosswalk, slimmed.

### Definition of done
- Enter ZIP + loan amount + term → see today's quoted rate range, HMDA distribution position, and monthly payment estimates with confidence intervals.

---

## v5 — Map UI + polish (the delight layer)

**Why last**: maps are visual sugar. They make the home page click-through faster but don't change the underlying value. Doing them last avoids painting ourselves into a corner with map state during data churn.

### Deliverables
- **Home page**: U.S. choropleth shaded by current state-level 30-yr rate (high = red, low = blue, neutral midpoint at national average). Click a state → drill to state page.
- **State page**: zoomed-in state shape with counties shaded by HMDA 2024 mean rate. Click a county → drill to county page.
- D3 + TopoJSON (`us-atlas` package). Counties at 1:500k resolution.
- Hover tooltips showing key stats per state/county.
- Mobile-friendly: dropdowns are the fallback; maps are progressively-enhanced for ≥md screens.
- Performance: lazy-load per-state JSON only when state is selected; code-split routes.
- SEO: per-state and per-county pages with proper `<title>` + meta descriptions; sitemap.xml.
- Accessibility: keyboard-navigable state/county selection; aria-labels on map regions.

### Files
- `src/components/UsChoropleth.tsx`
- `src/components/StateChoropleth.tsx`
- `src/data/topo/us-states-10m.json`
- `src/data/topo/{state}-counties-500k.json` (lazy-loaded)

### Definition of done
- Mobile and desktop both work. Lighthouse scores green. Pages indexed by Google.

---

## Cross-cutting architecture (decisions to lock now)

### Routing
React Router v6+, file structure `/`, `/state/:slug`, `/state/:slug/county/:countyFips`, `/calculator`. Static-generated by Vite at build time for SEO (pre-render each state/county page at build).

### Data delivery
- Per-state JSON lazy-loaded on route enter (avoid shipping all 50 states in initial bundle).
- HMDA county aggregates per state: ~100 counties × ~80 bytes × 51 states = ~400 KB total — affordable to ship eagerly, OR lazy per state.
- Daily JSONL accumulators stay in `data/daily/`; chart-ready JSON in `src/data/states/{slug}/`.

### Refresh cadence
- Bankrate / MND: daily per state.
- FRED PMMS: weekly is fine (Freddie publishes Thursdays); a daily fetch is harmless and idempotent.
- HMDA: annual. 2025 HMDA LAR drops mid-2026; we ingest it once when available.
- Wayback backfill: one-shot per phase; doesn't repeat.

### Bundle size targets
- v2 home page: <250 KB JS (gzipped).
- v3 state page: <300 KB JS + lazy 50 KB state JSON.
- v4 calculator: <350 KB JS.
- v5 home with map: <450 KB JS (TopoJSON dominates).

### Quality bars
- No interpolation of rate gaps; render breaks honestly.
- Surface all data provenance in tooltips (every NC point already does this in v1 — preserve through all phases).
- Methodology notes appear on every page; never hide caveats behind a click.

---

## Hard unknowns (resolve early)

These could change the plan; sequence the v2 work to surface them in the first week:

1. **Bankrate scraping at 50× scale**: do they rate-limit or block at scale? Quick check: run the existing fetcher against 5 random states in sequence; if all succeed, proceed; if 2 fail, redesign with proxies or longer delays.
2. **Wayback coverage distribution**: how many states have <12 monthly snapshots in window? Quick CDX survey will tell us; impacts whether the state's chart is mostly gaps and whether to skip it from the picker.
3. **HMDA 2024 LAR download size and shape**: confirm ~3 GB; confirm `county_code` is populated in ≥95% of rows; confirm `state_code` is the FIPS string (`"37"` for NC), not the postal code.
4. **Cron runtime ceiling**: 50 sequential Bankrate fetches at 15s each = 12.5 min. GitHub Actions free tier allows 6h/job. Plenty of headroom but worth measuring.
5. **Pages bundle size with all 50 states**: if static-pre-rendering at build creates a giant `dist/`, switch to lazy routes.

---

## Non-goals (explicit)

To keep scope honest:

- **Real-time / intraday rates** — daily refresh only.
- **Refinance rates** — purchase only for v2–v4; refi could be v6.
- **ARM / FHA / VA breakdown beyond conventional** — overlay only as a future enhancement.
- **Loan officer / lender directory** — not in scope.
- **User accounts / saved scenarios** — calculator is anonymous and stateless.
- **Pre-qualification / soft credit pull** — we point users to lenders, never collect PII.
- **Spanish / other localization** — English-only for v2–v5.
- **HMDA modified LAR (private)** — we use the public LAR; we never request the private fields.
- **Other countries** — U.S. only.

---

## Phasing summary

| Version | Focus | Rough effort | Risk |
|---|---|---|---|
| v1 (done) | NC dashboard, self-updating | — | — |
| **v2** | 50-state generalization | 2–3 person-weeks | Medium (scrape blocking, HMDA bulk) |
| **v3** | County HMDA distributions | 1–2 person-weeks | Low (mechanical aggregation) |
| **v4** | Borrower calculator | 2 person-weeks | Low (mostly UI) |
| **v5** | Maps + polish + SEO | 2–3 person-weeks | Medium (perf + mobile) |

Total to v5: 7–10 person-weeks of focused work. Each version ships independently and is publicly useful on its own.

---

## What I'd start with tomorrow

If we proceed, v2 Phase 1 is a 1-day spike:

1. Pick 3 representative states (CA, FL, WY — big, mid, small).
2. Run the existing Bankrate fetcher against each (just parameterize the slug).
3. Run a Wayback CDX query for each over the v1 window.
4. Run a quick national HMDA spot-check: download the LAR (or sample), confirm `state_code` distribution.

If all three look fine, the 50-state generalization is well-scoped. If any one fails (Bankrate blocks, Wayback empty, HMDA shape surprises), we redesign before committing 50× the effort.

That spike is where I'd want to start, on your word.
