# data/daily/

Append-only JSONL accumulators for daily-fetched rate observations.

- `bankrate_nc.jsonl` — one line per day of Bankrate NC fetches (headless browser).
- `mnd_nc.jsonl` — one line per day (or per Wayback snapshot) of Mortgage News Daily NC values.

**Do not edit by hand.** Files are written by `scripts/fetch_bankrate_nc_browser.py`, `scripts/fetch_mnd_nc.py`, and `scripts/backfill_mnd_wayback.py`. Each writer is idempotent by `date_iso` — re-runs on the same day overwrite that day's row.

Downstream, `scripts/aggregate_mnd_monthly.py` and `scripts/reconcile_nc.py` read these files to produce the chart-ready JSON in `src/data/`.
