# data/daily/

Append-only JSONL accumulators — the **raw observation floor** of the whole project. Every
chart-ready file under `src/data/` is derived from these; nothing here is derived from anything.
If a number on the site is wrong, this is where you check first.

> This file was fictional until 2026-08: it described two `*_nc.jsonl` files and named five scripts,
> four of which never existed. It now lists what is actually on disk. If you change the layout,
> change this file in the same commit.

## What's here

**153 files** (plus this README), one JSONL per source × state, named `{source}_{slug}.jsonl`
where `{slug}` is the same state slug used by `src/data/states/{slug}/` and `scripts/states.py`:

| Pattern | Count | Notes |
|---|---|---|
| `bankrate_{slug}.jsonl` | 50 | **No `bankrate_district-of-columbia.jsonl`** — Bankrate serves a 404 for the DC slug, so no page exists to scrape. Coded as `KNOWN_NO_COVERAGE` in `fetch_bankrate_state.py`, which exits 0 so the refresh validator skips it instead of reporting a failure. |
| `mnd_{slug}.jsonl` | 51 | Full 50 + DC coverage. |
| `nerdwallet_{slug}.jsonl` | 51 | Files exist for all 51, but **Nevada is `KNOWN_NO_COVERAGE`** in `fetch_nerdwallet_state.py` — no NerdWallet Nevada page exists, so `nerdwallet_nevada.jsonl` holds only rows the one-shot Wayback backfill recovered and never gains new ones. |
| `rocket.jsonl` | 1 | **No slug.** Rocket publishes a single national rate, so it lives at the top of the directory alongside the national FRED/PMMS series — see the comment on `_paths.rocket_jsonl()`. |

Regenerate the inventory with `ls data/daily | sed 's/_.*//' | sort | uniq -c`.

## Who writes them

**Do not edit by hand.** Writers, by file:

| File | Live writer (daily cron) | One-shot history writer |
|---|---|---|
| `bankrate_*.jsonl` | `scripts/fetch_bankrate_state.py` | — (the Bankrate backfill writes `src/data/states/{slug}/bankrate_*_dense.json`, **not** JSONL) |
| `mnd_*.jsonl` | `scripts/fetch_mnd_state.py` | — |
| `nerdwallet_*.jsonl` | `scripts/fetch_nerdwallet_state.py` | `scripts/backfill_nerdwallet_state_wayback.py` |
| `rocket.jsonl` | `scripts/fetch_rocket.py` (**not** from CI — see below) | `scripts/backfill_rocket_wayback.py` |

Each writer is **idempotent by `date_iso`** — re-running on the same day replaces that day's row
rather than appending a duplicate.

Rocket is the exception to "daily": Akamai denylists GitHub Actions' datacenter IPs, so the cron's
attempt fails by design and `rocket.jsonl` is refreshed from a residential machine via
`scripts/rocket_residential_refresh.ps1`. Expect visible gaps; `scripts/check_stale_sources.py`
flags the source past 8 days.

## Who reads them

| Reader | Consumes | Produces |
|---|---|---|
| `scripts/aggregate_mnd_state.py` | `mnd_{slug}.jsonl` | `src/data/states/{slug}/mnd_*.json` |
| `scripts/aggregate_nerdwallet_state.py` | `nerdwallet_{slug}.jsonl` | `src/data/states/{slug}/nerdwallet_*.json` |
| `scripts/aggregate_rocket.py` | `rocket.jsonl` | `src/data/rocket_{15,30}yr_{daily,monthly}.json` |
| `scripts/reconcile_state.py` | `bankrate_{slug}.jsonl` + the dense Wayback file | `src/data/states/{slug}/bankrate_*.json` (the monthly series) |
| `scripts/emit_daily_view.py` | `bankrate_`, `mnd_`, `nerdwallet_` for one slug | the trailing-days view JSON on each state page |
| `scripts/check_stale_sources.py` | every file here | the `stale-source` alarm |

## Why append-only, and why committed

These files are the only copy of an observation. A scraped rate cannot be refetched for a past day —
if a row is lost, that day is gone from the series permanently. So the accumulators are committed to
git on every refresh, which makes the repo history a full audit trail of every rate ever observed
and makes any corruption recoverable with `git show`.

Corollary: **never rewrite history here to "clean up" the data.** Fix the writer, let it correct the
row idempotently, and leave the previous state in the git log.
