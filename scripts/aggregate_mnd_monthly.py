"""Aggregate the MND NC JSONL into a 24-row monthly time series for the chart.

For each calendar month in Jun 2024 - May 2026 (the chart window), pick the
most-recent observation in that month (end-of-month convention) and emit the
chart-ready {m, date, rate, src} shape per term.

Months with no observation become {rate: null, src: "no archive"}.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _window import window_months  # noqa: E402
from _paths import DATA_DIR, MND_JSONL  # noqa: E402

JSONL_PATH = MND_JSONL
OUT_DIR = DATA_DIR

WINDOW = window_months()


def load_rows() -> list[dict]:
    if not os.path.exists(JSONL_PATH):
        return []
    out = []
    with open(JSONL_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def aggregate_term(rows: list[dict], term_key: str) -> list[dict]:
    # Group rows by (year, month) and pick the latest date_iso within each.
    by_month: dict[tuple[int, int], dict] = {}
    for r in rows:
        date_iso = r.get("date_iso")
        if not date_iso or r.get(term_key) is None:
            continue
        try:
            y, mo = int(date_iso[0:4]), int(date_iso[5:7])
        except ValueError:
            continue
        key = (y, mo)
        prior = by_month.get(key)
        if prior is None or date_iso > prior["date_iso"]:
            by_month[key] = r

    result = []
    for (y, mo) in WINDOW:
        m_label = f"{y}-{mo:02d}"
        chosen = by_month.get((y, mo))
        if chosen is None:
            result.append({
                "m": m_label,
                "date": f"{y}-{mo:02d}-15",
                "rate": None,
                "src": "no archive",
            })
            continue
        result.append({
            "m": m_label,
            "date": chosen["date_iso"],
            "rate": chosen[term_key],
            "src": "Mortgage News Daily NC"
                   + (" (Wayback)" if chosen.get("source") == "mnd_wayback" else ""),
        })
    return result


def main() -> int:
    rows = load_rows()
    if not rows:
        print(f"WARNING: {JSONL_PATH} is empty; outputs will be all gaps.", file=sys.stderr)

    for term, key in ((15, "term_15"), (30, "term_30")):
        agg = aggregate_term(rows, key)
        n_filled = sum(1 for r in agg if r["rate"] is not None)
        out_path = os.path.join(OUT_DIR, f"mnd_nc_{term}yr_monthly.json")
        with open(out_path, "w") as f:
            json.dump(agg, f, indent=2)
        print(f"  {term}-yr  {n_filled}/{len(agg)} months filled -> {out_path}")
        for r in agg:
            rate_str = f"{r['rate']:.2f}%" if r["rate"] is not None else "  -- "
            print(f"    {r['m']}  {r['date']:<10}  {rate_str:>6}  {r['src']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
