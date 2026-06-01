"""Reconcile state-level Bankrate snapshots into a 24-row chart-ready monthly
series for any state. Reads:
  - src/data/states/{slug}/bankrate_{term}yr_dense.json (Wayback historical)
  - data/daily/bankrate_{slug}.jsonl (latest live value, used for trailing month)

Emits:
  - src/data/states/{slug}/bankrate_{term}yr.json (24-row chart-ready)
  - src/data/states/{slug}/state_meta.json (with build timestamp etc.)
"""
import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import bankrate_jsonl, state_data_dir, WINDOW_JSON  # noqa: E402
from _window import window_months, write_window_json  # noqa: E402
from states import by_slug  # noqa: E402

STALE_DAYS = 7

MONTH_NAME = {
    1: "January", 2: "February", 3: "March", 4: "April",
    5: "May", 6: "June", 7: "July", 8: "August",
    9: "September", 10: "October", 11: "November", 12: "December",
}


def parse_as_of(as_of_str: str | None) -> str | None:
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


def load_latest_live(slug: str) -> dict | None:
    path = bankrate_jsonl(slug)
    if not os.path.exists(path):
        return None
    rows: list[dict] = []
    with open(path, "r", encoding="utf-8") as f:
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
    try:
        latest_date = dt.date.fromisoformat(latest["date_iso"])
    except (KeyError, ValueError):
        return None
    if (dt.date.today() - latest_date).days > STALE_DAYS:
        return None
    return latest


def reconcile_one(slug: str, term: int, dense: list[dict], live: dict | None) -> list[dict]:
    by_month = {row["month"]: row for row in dense}
    rows = []
    for (y, m) in window_months():
        m_label = f"{y}-{m:02d}"
        src_row = by_month.get(m_label)
        if src_row and src_row.get("bankrate_table_pct") is not None:
            date_iso = parse_as_of(src_row.get("as_of")) or f"{y}-{m:02d}-15"
            rows.append({
                "m": m_label,
                "date": date_iso,
                "rate": src_row["bankrate_table_pct"],
                "src": "Bankrate (Wayback)",
            })
        else:
            rows.append({"m": m_label, "date": f"{y}-{m:02d}-15", "rate": None, "src": "no archive"})

    # Apply live override for the latest month if present.
    if live:
        date_iso = live["date_iso"]
        y, mo, _ = date_iso.split("-")
        m_label = f"{y}-{mo}"
        rate = live.get(f"table_{term}") or live.get(f"intro_{term}")
        if rate is not None:
            for r in rows:
                if r["m"] == m_label:
                    r["date"] = date_iso
                    r["rate"] = rate
                    r["src"] = "Bankrate (live)"
                    break
    return rows


def reconcile_state(slug: str) -> int:
    state = by_slug(slug)
    out_dir = state_data_dir(slug)
    os.makedirs(out_dir, exist_ok=True)
    live = load_latest_live(slug)

    write_window_json(WINDOW_JSON)

    for term in (15, 30):
        dense_path = os.path.join(out_dir, f"bankrate_{term}yr_dense.json")
        if not os.path.exists(dense_path):
            print(f"  {slug} {term}-yr: no dense file at {dense_path}; treating as empty")
            dense = []
        else:
            with open(dense_path) as f:
                dense = json.load(f)
        rows = reconcile_one(slug, term, dense, live)
        n_filled = sum(1 for r in rows if r["rate"] is not None)
        out_path = os.path.join(out_dir, f"bankrate_{term}yr.json")
        with open(out_path, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"  {state['name']} {term}-yr: {n_filled}/{len(rows)} months filled -> bankrate_{term}yr.json")

    # Write a tiny per-state meta file with the build timestamp.
    meta_path = os.path.join(out_dir, "state_meta.json")
    with open(meta_path, "w") as f:
        json.dump({
            "slug": state["slug"],
            "postal": state["postal"],
            "fips": state["fips"],
            "name": state["name"],
            "built_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "has_hmda_band": os.path.exists(os.path.join(out_dir, "hmda_2024_15yr.json")),
            "live_trailing": live is not None,
        }, f, indent=2)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="north-carolina")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if args.all:
        from states import STATES
        rc = 0
        for s in STATES:
            if reconcile_state(s["slug"]) != 0:
                rc = 1
        return rc
    return reconcile_state(args.state)


if __name__ == "__main__":
    sys.exit(main())
