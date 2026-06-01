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
import urllib.request
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _window import window_months  # noqa: E402
from _paths import DATA_DIR  # noqa: E402

OUT_DIR = DATA_DIR
SERIES = {15: "MORTGAGE15US", 30: "MORTGAGE30US"}
HEADERS = {"User-Agent": "MortgageDashboard/1.0 (research)"}

_window = window_months()
WINDOW_START = datetime(_window[0][0], _window[0][1], 1)
# end of last window month
_end_y, _end_m = _window[-1]
WINDOW_END = datetime(_end_y, _end_m, 28) + dt.timedelta(days=10)  # safely into next month


def fetch_series(fred_id: str) -> list[tuple[datetime, float]]:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode("utf-8")
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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for term, fred_id in SERIES.items():
        print(f"Fetching {fred_id} ({term}-yr) ...")
        weekly = fetch_series(fred_id)
        if not weekly:
            print(f"  WARNING: no observations returned for {fred_id}")
            continue
        monthly = aggregate(weekly)
        print(f"  {len(weekly)} weekly observations -> {len(monthly)} months in window")
        for row in monthly:
            print(f"    {row['month']}  {row['rate']:.3f}%  ({row['n_weeks']} weeks)")
        out_path = os.path.join(OUT_DIR, f"pmms_{term}yr_monthly.json")  # noqa
        with open(out_path, "w") as f:
            json.dump(monthly, f, indent=2)
        print(f"  Saved -> {out_path}\n")


if __name__ == "__main__":
    main()
