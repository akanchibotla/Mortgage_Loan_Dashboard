"""Aggregate Rocket Mortgage daily JSONL into a rolling monthly time series.

Reads data/daily/rocket.jsonl and emits:
  src/data/rocket_15yr_monthly.json
  src/data/rocket_30yr_monthly.json

Rocket publishes a single national rate, so there's no per-state loop here —
exactly one pair of monthly aggregates. Each month picks the most recent
observation that falls inside it; gaps render as null rows so the chart
draws honest breaks.

Shape matches the existing PMMS monthly files ({month, rate, n_obs}) so the
React chart can treat Rocket as a second national line alongside PMMS without
introducing a new chart-point type.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import rocket_daily, rocket_jsonl, rocket_monthly  # noqa: E402
from _window import window_months  # noqa: E402


def load_rows(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(
                    f"  load_rows({path}): skipped malformed JSON: {e}",
                    file=sys.stderr,
                )
    return out


def aggregate_term(rows: list[dict], term_key: str) -> list[dict]:
    by_month: dict[tuple[int, int], list[dict]] = {}
    for r in rows:
        d = r.get("date_iso")
        if not d or r.get(term_key) is None:
            continue
        try:
            y, mo = int(d[0:4]), int(d[5:7])
        except ValueError:
            continue
        by_month.setdefault((y, mo), []).append(r)

    result = []
    for (y, mo) in window_months():
        m_label = f"{y}-{mo:02d}"
        rows_in_month = by_month.get((y, mo), [])
        if not rows_in_month:
            result.append({"month": m_label, "rate": None, "n_obs": 0})
            continue
        # Mean of the daily observations in the month — closer to PMMS's
        # weekly-mean concept than picking just the latest day.
        vals = [r[term_key] for r in rows_in_month if r.get(term_key) is not None]
        if not vals:
            result.append({"month": m_label, "rate": None, "n_obs": 0})
            continue
        mean = sum(vals) / len(vals)
        result.append({
            "month": m_label,
            "rate": round(mean, 3),
            "n_obs": len(vals),
        })
    return result


def daily_in_window(rows: list[dict], term_key: str) -> list[dict]:
    """Emit every successful daily observation for a term as a DailyRatePoint
    row. Sparse on purpose — Rocket's daily JSONL averages ~1 row/month due
    to Akamai blocks, so this layer surfaces individual capture days as
    hover-only anchors on the chart (no visible line between them, since
    spans of weeks between points would imply a slope we never observed)."""
    months_in_window = set(window_months())
    out: list[dict] = []
    for r in sorted(rows, key=lambda x: x.get("date_iso", "")):
        d = r.get("date_iso")
        if not d or r.get(term_key) is None:
            continue
        try:
            y, mo = int(d[0:4]), int(d[5:7])
        except ValueError:
            continue
        if (y, mo) not in months_in_window:
            continue
        method = r.get("source_method") or "live"
        src = "Rocket Mortgage (Wayback)" if str(method).startswith("wayback") else "Rocket Mortgage"
        out.append({"date": d, "rate": r[term_key], "src": src})
    return out


def main() -> int:
    rows = load_rows(rocket_jsonl())
    for term, key in ((15, "term_15"), (30, "term_30")):
        agg = aggregate_term(rows, key)
        n_filled = sum(1 for r in agg if r["rate"] is not None)
        path = rocket_monthly(term)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(agg, f, indent=2)
        print(f"  Rocket {term}-yr: {n_filled}/{len(agg)} months filled -> {os.path.basename(path)}")
        daily_rows = daily_in_window(rows, key)
        daily_path = rocket_daily(term)
        with open(daily_path, "w") as f:
            json.dump(daily_rows, f, indent=2)
        print(f"  Rocket {term}-yr: {len(daily_rows)} daily observations -> {os.path.basename(daily_path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
