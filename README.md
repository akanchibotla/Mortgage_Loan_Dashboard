# Mortgage Loan Dashboard

Self-updating dashboard comparing North Carolina vs. U.S. mortgage rates (15-yr and 30-yr fixed). Built on Vite + React + TypeScript with Chart.js. Data refreshes daily via GitHub Actions and deploys to GitHub Pages.

## Quick start (local)

```
npm install
pip install -r requirements.txt
python -m playwright install chromium     # for headless Bankrate fetch
npm run dev
```

Open http://localhost:5173.

To refresh the data locally before viewing:

```
python scripts/fetch_fred.py                  # U.S. monthly series (FRED PMMS)
python scripts/fetch_bankrate_nc_browser.py   # today's Bankrate NC values (headless Chromium)
python scripts/fetch_mnd_nc.py                # today's Mortgage News Daily NC values
python scripts/aggregate_mnd_monthly.py       # JSONL -> monthly chart data
python scripts/reconcile_nc.py                # merge Wayback + live for trailing month
```

## Deploy to GitHub Pages

This repo is set up to auto-deploy and auto-refresh. To activate:

1. Create an **empty public GitHub repo** named `Mortgage_Loan_Dashboard` (or any name — see step 3 to override).
2. From this directory:
   ```
   git remote add origin https://github.com/<your-user>/Mortgage_Loan_Dashboard.git
   git add .
   git commit -m "Initial dashboard"
   git push -u origin main
   ```
3. In the repo's **Settings → Pages**, set **Source = GitHub Actions**.
4. (Only if your repo name differs from `Mortgage_Loan_Dashboard`): the deploy workflow auto-derives the base path from `github.event.repository.name`, so no further change is needed. If using a custom domain, set `VITE_BASE_PATH=/` in the workflow env.

On the first push:
- `.github/workflows/deploy.yml` runs → builds → deploys to Pages. URL appears under **Actions → Deploy to GitHub Pages → page_url**.
- `.github/workflows/refresh.yml` runs **daily at 12:00 UTC** → fetches fresh data → commits → triggers a re-deploy. You can also trigger it manually from the **Actions** tab (`Daily refresh → Run workflow`).

## Data sources

| Source | Where | Refresh |
|---|---|---|
| Freddie Mac PMMS (U.S. 15-yr and 30-yr weekly) | [FRED MORTGAGE15US](https://fred.stlouisfed.org/series/MORTGAGE15US) / [MORTGAGE30US](https://fred.stlouisfed.org/series/MORTGAGE30US) | Weekly (auto via `fetch_fred.py`) |
| Bankrate NC purchase rates | [bankrate.com](https://www.bankrate.com/mortgages/mortgage-rates/north-carolina/) (live, headless Chromium) + Internet Archive | Daily (auto via `fetch_bankrate_nc_browser.py`) for trailing month; historical from Wayback (one-shot) |
| Mortgage News Daily NC | [mortgagenewsdaily.com](https://www.mortgagenewsdaily.com/mortgage-rates/north-carolina) (live) + Wayback (sparse) | Daily (auto via `fetch_mnd_nc.py`); historical from `backfill_mnd_wayback.py` |
| HMDA 2024 NC 15-yr origination distribution | [FFIEC HMDA Data Browser](https://ffiec.cfpb.gov/data-browser/) | Annual, frozen (no live refresh needed) |

Chart-ready JSON lives in `src/data/`. Append-only daily accumulators live in `data/daily/`. Raw inputs (HMDA CSV, Bankrate Wayback HTML, Freddie xlsx) live outside the repo in `C:\Users\akanc\Documents\` and aren't committed.

## File layout

```
src/                  React + TS dashboard
  data/               Chart-ready JSON (committed; auto-refreshed)
  chart/              Chart.js registration + options factory
  components/         RateChart, RateTable
  App.tsx, main.tsx   Layout entry
data/daily/           Append-only JSONL accumulators (committed)
scripts/              Python fetchers + reconciliation
  _paths.py           Repo-relative path constants
  _window.py          Rolling window (24-month start through current month)
.github/workflows/
  deploy.yml          Build + Pages deploy on push to main
  refresh.yml         Daily cron: fetch, aggregate, commit
requirements.txt      Python deps (Playwright, openpyxl)
package.json          Node deps (Vite, React, Chart.js)
```

## Known limitations

- **Bankrate hydrates rates via client-side JS**, so the browser-fetcher needs Chromium installed both locally and in CI (handled automatically; ~60s extra on cold runs).
- **MND historical via Wayback is sparse** (~4 snapshots in 24 months as of writing). The series grows denser as daily forward-collection accumulates.
- **HMDA has no month-of-origination field**, so the HMDA reference band is annual only (2024 distribution shown as a 2024-spanning box).
- **Pages requires a public repo** on the free tier. For a private repo, switch deploys to Cloudflare Pages / Vercel or upgrade GitHub.
