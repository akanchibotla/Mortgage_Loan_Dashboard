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

_window = window_months()
WINDOW_START = datetime(_window[0][0], _window[0][1], 1)
# end of last window month
_end_y, _end_m = _window[-1]
WINDOW_END = datetime(_end_y, _end_m, 28) + dt.timedelta(days=10)  # safely into next month


def _fetch_csv_once(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return r.read().decode("utf-8")


def fetch_series(fred_id: str) -> list[tuple[datetime, float]]:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}"
    raw = None
    last_err: Exception | None = None
    for attempt in range(len(RETRY_DELAYS_S) + 1):
        try:
            raw = _fetch_csv_once(url)
            break
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as e:
            last_err = e
            if attempt < len(RETRY_DELAYS_S):
                delay = RETRY_DELAYS_S[attempt]
                print(f"  attempt {attempt + 1} failed: {e}; sleeping {delay}s before retry", file=sys.stderr)
                time.sleep(delay)
            else:
                print(f"  attempt {attempt + 1} failed: {e}; giving up", file=sys.stderr)
    if raw is None:
        raise RuntimeError(f"FRED fetch for {fred_id} failed after retries: {last_err}")
    out: list[tuple[datetime, float]] = []
    reader = csv.DictReader(io.StringIO(raw))
    # FRED columns: 'observation_date', '<SERIES_ID>'
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
        print(f"  Saved -> {out_path}\n")
    if failures:
        # Exit 0 anyway — keep workflow alive. Existing cached PMMS JSONs remain
        # untouched, so the dashboard keeps yesterday's values for failed series.
        print(f"FRED summary: failed series: {failures}; previous JSON kept on disk.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
