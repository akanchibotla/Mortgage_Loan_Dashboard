"""Download FRED MORTGAGE15US and MORTGAGE30US (Freddie Mac PMMS weekly via
St. Louis Fed) and aggregate to monthly mean over Jun 2024 - May 2026.

Emits the same {month, rate, n_weeks} shape that parse_pmms.py emitted, so no
downstream change is needed. Use this in place of parse_pmms.py going forward.
"""
import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _window import window_months  # noqa: E402
from _paths import DATA_DIR  # noqa: E402

OUT_DIR = DATA_DIR
SERIES = {15: "MORTGAGE15US", 30: "MORTGAGE30US"}
# Browser-ish UA — FRED's CSV endpoint sometimes blocks/throttles short ones.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,*/*;q=0.9",
}
RETRY_DELAYS_S = [3, 8, 20]  # 3 attempts: try, wait 3s, retry, wait 8s, retry, wait 20s, final
TIMEOUT_S = 120
# Path used by the workflow's `Summarize partial failures` step to surface
# script-level failures. Set via FAIL_LOG env in CI; in local runs we still
# write to it if defined.
FAIL_LOG = os.environ.get("FAIL_LOG")

_window = window_months()
WINDOW_START = datetime(_window[0][0], _window[0][1], 1)
# end of last window month
_end_y, _end_m = _window[-1]
WINDOW_END = datetime(_end_y, _end_m, 28) + dt.timedelta(days=10)  # safely into next month


def _fetch_csv_once(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return r.read().decode("utf-8")


def _retry_loop(url: str, label: str) -> str | None:
    """Try the same URL up to len(RETRY_DELAYS_S)+1 times with backoff. Returns
    the CSV body on success or None if every attempt raises."""
    last_err: Exception | None = None
    for attempt in range(len(RETRY_DELAYS_S) + 1):
        try:
            return _fetch_csv_once(url)
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as e:
            last_err = e
            if attempt < len(RETRY_DELAYS_S):
                delay = RETRY_DELAYS_S[attempt]
                print(
                    f"  [{label}] attempt {attempt + 1} failed: {e}; sleeping {delay}s before retry",
                    file=sys.stderr,
                )
                time.sleep(delay)
            else:
                print(f"  [{label}] attempt {attempt + 1} failed: {e}; giving up", file=sys.stderr)
    print(f"  [{label}] exhausted retries; last error: {last_err}", file=sys.stderr)
    return None


def _parse_csv(raw: str) -> list[tuple[datetime, float]]:
    out: list[tuple[datetime, float]] = []
    reader = csv.DictReader(io.StringIO(raw))
    val_col = next(c for c in (reader.fieldnames or []) if c != "observation_date")
    for row in reader:
        date_str = row["observation_date"]
        val_str = row[val_col]
        if val_str in ("", ".", None):
            continue
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
            v = float(val_str)
        except ValueError:
            continue
        out.append((d, v))
    return out


def fetch_series_html_fallback(fred_id: str) -> list[tuple[datetime, float]]:
    """Tier 3 fallback: scrape the latest weekly observation from FRED's series
    HTML page. Returns a single-row list (just the latest week) so the monthly
    aggregator can still produce a row for the current month even when the CSV
    endpoint is completely down. The HTML page tends to stay up when the CSV
    endpoint dies — they're served by different subsystems."""
    url = f"https://fred.stlouisfed.org/series/{fred_id}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            html = r.read().decode("utf-8", errors="replace")
    except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  HTML fallback raised: {e}", file=sys.stderr)
        return []
    # Look for a JSON-LD or text pattern like "2026-05-29: 6.10" — FRED renders
    # the latest observation prominently. We try a couple of forms.
    import re as _re
    m = _re.search(r'"latestObservationDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', html)
    v = _re.search(r'"latestObservationValue"\s*:\s*"?([\d.]+)"?', html)
    if m and v:
        try:
            return [(datetime.strptime(m.group(1), "%Y-%m-%d"), float(v.group(1)))]
        except ValueError:
            pass
    # Fallback text form: "Jun 5, 2026:  6.10 Percent" etc.
    m2 = _re.search(
        r"<title>[^<]*?\(([A-Z]+\d+US)\)[^<]*?</title>",
        html,
    )
    obs = _re.search(
        r"(\d{4}-\d{2}-\d{2})[^<>]{1,40}?([\d.]+)\s*Percent",
        html,
    )
    if obs:
        try:
            return [(datetime.strptime(obs.group(1), "%Y-%m-%d"), float(obs.group(2)))]
        except ValueError:
            pass
    print(f"  HTML fallback: could not extract latest observation from {url}", file=sys.stderr)
    return []


def fetch_series_api(fred_id: str) -> list[tuple[datetime, float]]:
    """Tier 0: official FRED API (api.stlouisfed.org). Most reliable endpoint
    when a free API key is configured via the FRED_API_KEY env var. Returns
    [] when no key is set OR when the API request fails — callers always fall
    through to the CSV/HTML tiers in either case, so the script keeps working
    even without an API key configured."""
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        return []
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={fred_id}&api_key={api_key}&file_type=json"
    )
    backoffs = [2, 5]
    payload: dict | None = None
    last_err: Exception | None = None
    for attempt in range(len(backoffs) + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = json.loads(r.read().decode("utf-8"))
            break
        except (
            TimeoutError,
            urllib.error.URLError,
            urllib.error.HTTPError,
            json.JSONDecodeError,
        ) as e:
            last_err = e
            print(f"  [{fred_id} API] attempt {attempt + 1} failed: {e}", file=sys.stderr)
            if attempt < len(backoffs):
                time.sleep(backoffs[attempt])
    if payload is None:
        print(f"  [{fred_id} API] exhausted retries; last error: {last_err}", file=sys.stderr)
        return []
    obs = payload.get("observations") or []
    out: list[tuple[datetime, float]] = []
    for row in obs:
        if not isinstance(row, dict):
            continue
        date_str = row.get("date", "")
        val_str = row.get("value", ".")
        if val_str in ("", ".", None):
            continue
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
            v = float(val_str)
        except (ValueError, TypeError):
            continue
        out.append((d, v))
    return out


def fetch_series_freddiemac(fred_id: str) -> list[tuple[datetime, float]]:
    """Tier 1 fallback: scrape Freddie Mac's PMMS landing page for the most
    recent week's published rate. Freddie publishes the same weekly survey
    that backs MORTGAGE15US / MORTGAGE30US on FRED, but on independent
    infrastructure (freddiemac.com vs fred.stlouisfed.org/api.stlouisfed.org)
    — so it's a true belt-and-suspenders fallback that survives FRED-wide
    outages. Returns a single-row list (latest week only); the monthly
    aggregator still produces a current-month row from it."""
    term = {"MORTGAGE15US": 15, "MORTGAGE30US": 30}.get(fred_id)
    if term is None:
        return []
    url = "https://www.freddiemac.com/pmms"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="replace")
    except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  Freddie Mac PMMS raised: {e}", file=sys.stderr)
        return []
    import re as _re
    # Anchor on the canonical "{term}-year fixed-rate mortgage" wording. The
    # year-ago reference on the same page uses "{term}-year FRM averaged …"
    # — different phrasing, so the regex won't false-match on it. Allow any
    # chars between "mortgage" and "averaged" (the 15-year paragraph has
    # "</strong>&nbsp;" between them; the 30-year has plain text), capped
    # at 80 chars so we don't accidentally span to a different sentence.
    rate_pat = _re.compile(
        rf"{term}-year fixed-rate mortgage.{{0,80}}?averaged\s+(\d\.\d{{2,3}})\s*%",
        _re.IGNORECASE | _re.DOTALL,
    )
    m = rate_pat.search(html)
    if not m:
        print(f"  Freddie Mac PMMS: no current {term}-yr rate found", file=sys.stderr)
        return []
    try:
        rate = float(m.group(1))
    except ValueError:
        return []
    # Survey date appears as "as of May 28, 2026" or "as of 05/28/2026".
    date_pat = _re.compile(
        r"as of\s+([A-Za-z]+\s+\d{1,2},?\s+20\d{2}|\d{1,2}/\d{1,2}/20\d{2})",
        _re.IGNORECASE,
    )
    dm = date_pat.search(html)
    survey_date = datetime.today()
    if dm:
        ds = dm.group(1).replace(",", "")
        for fmt in ("%B %d %Y", "%b %d %Y", "%m/%d/%Y"):
            try:
                survey_date = datetime.strptime(ds, fmt)
                break
            except ValueError:
                continue
    return [(survey_date, rate)]


def fetch_series(fred_id: str) -> list[tuple[datetime, float]]:
    """Five-tier fetch (each tier fires only when the previous yielded nothing):
      Tier 0 — FRED API (requires FRED_API_KEY). Full series; most reliable.
      Tier 1 — Freddie Mac PMMS direct (freddiemac.com). Independent host —
               survives FRED outages. Returns single latest weekly row.
      Tier 2 — primary fredgraph.csv endpoint (currently flaky from CI IPs).
      Tier 3 — alternate series/X/downloaddata/X.csv endpoint.
      Tier 4 — HTML scrape of series/X page (single latest weekly row).
    Tier 0 silently skips when no API key is set; cascade still works. Raises
    only when every available tier has failed."""
    api_rows = fetch_series_api(fred_id)
    if api_rows:
        print(
            f"  [{fred_id}] FRED API yielded {len(api_rows)} weekly observations "
            f"(latest {api_rows[-1][0].date().isoformat()} = {api_rows[-1][1]})",
            file=sys.stderr,
        )
        return api_rows

    fm_rows = fetch_series_freddiemac(fred_id)
    if fm_rows:
        print(
            f"  [{fred_id}] Freddie Mac PMMS yielded latest observation "
            f"{fm_rows[0][0].date().isoformat()} = {fm_rows[0][1]}",
            file=sys.stderr,
        )
        return fm_rows

    primary_url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}"
    alt_url = f"https://fred.stlouisfed.org/series/{fred_id}/downloaddata/{fred_id}.csv"

    raw = _retry_loop(primary_url, f"{fred_id} primary CSV")
    if raw is None:
        raw = _retry_loop(alt_url, f"{fred_id} alt CSV")
    if raw is not None:
        try:
            return _parse_csv(raw)
        except (StopIteration, KeyError, ValueError) as e:
            print(f"  CSV parse failed: {e}; falling through to HTML scrape", file=sys.stderr)
    # Last resort: HTML page scrape (single-row return)
    html_rows = fetch_series_html_fallback(fred_id)
    if html_rows:
        print(
            f"  [{fred_id}] HTML fallback yielded latest observation "
            f"{html_rows[0][0].date().isoformat()} = {html_rows[0][1]}",
            file=sys.stderr,
        )
        return html_rows
    raise RuntimeError(f"FRED fetch for {fred_id} failed across all tiers")


def aggregate(weekly: list[tuple[datetime, float]]) -> list[dict]:
    monthly: dict[tuple[int, int], list[float]] = defaultdict(list)
    for d, v in weekly:
        if not (WINDOW_START <= d <= WINDOW_END):
            continue
        monthly[(d.year, d.month)].append(v)
    results = []
    for ym in sorted(monthly):
        vals = monthly[ym]
        results.append({
            "month": f"{ym[0]}-{ym[1]:02d}",
            "rate": round(sum(vals) / len(vals), 3),
            "n_weeks": len(vals),
        })
    return results


def weekly_in_window(weekly: list[tuple[datetime, float]]) -> list[dict]:
    """Filter FRED's raw weekly observations to the chart window and emit
    them as DailyRatePoint-shaped rows. Feeds the chart's weekly-resolution
    hover layer (invisible markers on monthly view, visible line+markers on
    weekly view) so users can scrub the PMMS line at week-level precision
    without us having to display every Thursday tick on the monthly chart."""
    rows: list[dict] = []
    for d, v in sorted(weekly, key=lambda dv: dv[0]):
        if not (WINDOW_START <= d <= WINDOW_END):
            continue
        rows.append({
            "date": d.date().isoformat(),
            "rate": round(v, 3),
            "src": "FRED PMMS",
        })
    return rows


def _append_fail_log(line: str) -> None:
    if not FAIL_LOG:
        return
    try:
        with open(FAIL_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError as e:
        print(f"  WARNING: could not append to FAIL_LOG ({FAIL_LOG}): {e}", file=sys.stderr)


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    failures: list[str] = []
    for term, fred_id in SERIES.items():
        print(f"Fetching {fred_id} ({term}-yr) ...")
        try:
            weekly = fetch_series(fred_id)
        except Exception as e:
            print(f"  ERROR: {fred_id} failed: {e}", file=sys.stderr)
            failures.append(fred_id)
            continue
        if not weekly:
            print(f"  WARNING: no observations returned for {fred_id}")
            failures.append(fred_id)
            continue
        monthly = aggregate(weekly)
        print(f"  {len(weekly)} weekly observations -> {len(monthly)} months in window")
        for row in monthly:
            print(f"    {row['month']}  {row['rate']:.3f}%  ({row['n_weeks']} weeks)")
        out_path = os.path.join(OUT_DIR, f"pmms_{term}yr_monthly.json")  # noqa
        with open(out_path, "w") as f:
            json.dump(monthly, f, indent=2)
        print(f"  Saved -> {out_path}")
        weekly_rows = weekly_in_window(weekly)
        weekly_path = os.path.join(OUT_DIR, f"pmms_{term}yr_weekly.json")
        with open(weekly_path, "w") as f:
            json.dump(weekly_rows, f, indent=2)
        print(f"  Saved -> {weekly_path}  ({len(weekly_rows)} weekly rows)\n")
    if failures:
        # Exit 0 anyway — keep workflow alive. Existing cached PMMS JSONs
        # remain untouched, so the dashboard keeps yesterday's values for
        # failed series. But surface the failure in FAIL_LOG so the user
        # sees it instead of silently shipping stale data.
        msg = f"FRED summary: failed series: {failures}; previous JSON kept on disk."
        print(msg, file=sys.stderr)
        for fid in failures:
            _append_fail_log(f"fred:{fid} (stale: kept previous JSON)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
