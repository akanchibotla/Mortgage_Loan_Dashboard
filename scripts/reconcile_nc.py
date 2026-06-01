"""Reconcile dense Bankrate snapshots into a 24-row chart-ready monthly series
covering Jun 2024 - May 2026 inclusive. Inserts null rows for unarchived
months. The trailing-month value for both terms is read from the
data/daily/bankrate_nc.jsonl accumulator (latest line within 7 days);
otherwise falls back to the hardcoded constants below.
"""
import datetime as dt
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _window import window_months, write_window_json  # noqa: E402
from _paths import DATA_DIR as _DATA_DIR, BANKRATE_JSONL as _BANKRATE_JSONL, WINDOW_JSON as _WINDOW_JSON  # noqa: E402

DATA_DIR = _DATA_DIR
WINDOW_JSON = _WINDOW_JSON
BANKRATE_JSONL = _BANKRATE_JSONL
STALE_DAYS = 7

WINDOW = window_months()

MONTH_NAME = {
    1: "January", 2: "February", 3: "March", 4: "April",
    5: "May", 6: "June", 7: "July", 8: "August",
    9: "September", 10: "October", 11: "November", 12: "December",
}

# Hardcoded fallbacks for trailing months when the JSONL accumulator is missing
# or stale. The Experian 2026-04 fallback has no live source.
FALLBACK_OVERRIDES = {
    15: {
        "2026-04": {"date": "2026-04-15", "rate": 6.05, "src": "Experian NC (prior-month ref)"},
        "2026-05": {"date": "2026-05-31", "rate": 5.91, "src": "Bankrate NC (fallback constant)"},
    },
    30: {
        "2026-04": None,
        "2026-05": {"date": "2026-05-31", "rate": 6.63, "src": "Bankrate NC (fallback constant)"},
    },
}


def parse_as_of(as_of_str: str | None) -> str | None:
    """Convert 'Wednesday, June 12, 2024' -> '2024-06-12'."""
    if not as_of_str:
        return None
    try:
        _, rest = as_of_str.split(",", 1)
        month_name, day_year = rest.strip().split(" ", 1)
        day_str, year_str = day_year.replace(",", "").split(" ")
        month_num = next(n for n, name in MONTH_NAME.items() if name == month_name)
        return f"{int(year_str):04d}-{month_num:02d}-{int(day_str):02d}"
    except Exception:
        return None


def load_bankrate_latest() -> dict | None:
    """Return the latest row from the Bankrate JSONL, or None if stale/missing."""
    if not os.path.exists(BANKRATE_JSONL):
        return None
    rows: list[dict] = []
    with open(BANKRATE_JSONL, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    if not rows:
        return None
    rows.sort(key=lambda r: r.get("date_iso", ""))
    latest = rows[-1]
    latest_date_str = latest.get("date_iso")
    if not latest_date_str:
        return None
    try:
        latest_date = dt.date.fromisoformat(latest_date_str)
    except ValueError:
        return None
    if (dt.date.today() - latest_date).days > STALE_DAYS:
        print(f"WARNING: Bankrate JSONL latest is {latest_date_str} (>{STALE_DAYS} days old); using fallback constants.")
        return None
    return latest


def build_overrides() -> dict:
    """Merge: Experian fallback + JSONL-derived live trailing or constant fallback."""
    overrides: dict = {15: dict(FALLBACK_OVERRIDES[15]), 30: dict(FALLBACK_OVERRIDES[30])}
    latest = load_bankrate_latest()
    if latest is None:
        print("Using FALLBACK trailing-month constants (no fresh Bankrate JSONL).")
        return overrides

    date_iso = latest["date_iso"]
    y, mo, _ = date_iso.split("-")
    month_label = f"{y}-{mo}"
    print(f"Using JSONL trailing: {date_iso} (table_15={latest.get('table_15')}, table_30={latest.get('table_30')})")
    for term in (15, 30):
        rate = latest.get(f"table_{term}") or latest.get(f"intro_{term}")
        if rate is None:
            continue
        overrides[term][month_label] = {
            "date": date_iso,
            "rate": rate,
            "src": "Bankrate NC (live, today)",
        }
    return overrides


def reconcile(term: int, overrides: dict) -> list:
    dense_path = os.path.join(DATA_DIR, f"nc_bankrate_{term}yr_dense.json")
    with open(dense_path) as f:
        dense = json.load(f)
    by_month = {row["month"]: row for row in dense}

    rows = []
    for (y, m) in WINDOW:
        m_label = f"{y}-{m:02d}"
        override = overrides.get(term, {}).get(m_label, "no-override")
        if override and override != "no-override":
            rows.append({"m": m_label, **override})
            continue
        if override is None:
            rows.append({"m": m_label, "date": f"{y}-{m:02d}-15", "rate": None, "src": "no archive"})
            continue
        src_row = by_month.get(m_label)
        if src_row and src_row.get("bankrate_table_pct") is not None:
            date_iso = parse_as_of(src_row.get("as_of")) or f"{y}-{m:02d}-15"
            rows.append({
                "m": m_label,
                "date": date_iso,
                "rate": src_row["bankrate_table_pct"],
                "src": "Bankrate NC (Wayback)",
            })
        else:
            rows.append({"m": m_label, "date": f"{y}-{m:02d}-15", "rate": None, "src": "no archive"})
    return rows


def main() -> int:
    write_window_json(WINDOW_JSON)
    print(f"Window: {WINDOW[0][0]}-{WINDOW[0][1]:02d} .. {WINDOW[-1][0]}-{WINDOW[-1][1]:02d} ({len(WINDOW)} months)")
    overrides = build_overrides()
    for term in (15, 30):
        rows = reconcile(term, overrides)
        out_path = os.path.join(DATA_DIR, f"nc_bankrate_{term}yr_monthly.json")
        with open(out_path, "w") as f:
            json.dump(rows, f, indent=2)
        n_filled = sum(1 for r in rows if r["rate"] is not None)
        print(f"=== {term}-yr ===  {n_filled}/{len(rows)} months filled  -> nc_bankrate_{term}yr_monthly.json")
        # Print only the trailing two months for brevity.
        for r in rows[-2:]:
            rate_str = f"{r['rate']:.2f}%" if r["rate"] is not None else "  --  "
            print(f"  {r['m']}  {r['date']:<10}  {rate_str:>7}  {r['src']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
