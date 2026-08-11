"""Reconcile state-level Bankrate snapshots into a 24-row chart-ready monthly
series for any state. Reads:
  - src/data/states/{slug}/bankrate_{term}yr_dense.json (Wayback historical)
  - data/daily/bankrate_{slug}.jsonl (live daily observations; the PRIMARY
    source for every month it covers, with the Wayback dense file as fallback)

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
from _jsonl import read_jsonl  # noqa: E402
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
    """Parse a Bankrate "as_of" string like "Tuesday, January 7, 2026" into
    an ISO date. Logs to stderr when the parse fails so silent format
    changes upstream don't quietly fall back to a fabricated 15th-of-month
    placeholder downstream.
    """
    if not as_of_str:
        return None
    try:
        _, rest = as_of_str.split(",", 1)
        month_name, day_year = rest.strip().split(" ", 1)
        day_str, year_str = day_year.replace(",", "").split(" ")
        month_num = next(n for n, name in MONTH_NAME.items() if name == month_name)
        return f"{int(year_str):04d}-{month_num:02d}-{int(day_str):02d}"
    except Exception as e:
        print(
            f"  parse_as_of: failed to parse {as_of_str!r}: {e}",
            file=sys.stderr,
        )
        return None


def load_all_live(slug: str) -> list[dict]:
    """Every row in the state's live Bankrate accumulator, oldest first.

    The whole file, not just the tail: reconcile_one now builds a per-MONTH
    live series from it (see the WHY there), so discarding everything but the
    newest row would throw away the very history this reads for.
    """
    path = bankrate_jsonl(slug)
    rows = [r for r in read_jsonl(path) if r.get("date_iso")]
    rows.sort(key=lambda r: (r.get("date_iso", ""), r.get("fetched_at_utc", "")))
    return rows


def load_latest_live(slug: str) -> dict | None:
    """The newest live row, or None when it is older than STALE_DAYS.

    Still used for the CURRENT month's freshness gate and for state_meta's
    `live_trailing` flag — a stale tail must not be presented as today's rate.
    """
    rows = load_all_live(slug)
    if not rows:
        return None
    latest = rows[-1]
    try:
        latest_date = dt.date.fromisoformat(latest["date_iso"])
    except (KeyError, ValueError):
        return None
    if (dt.date.today() - latest_date).days > STALE_DAYS:
        return None
    return latest


def live_by_month(live_rows: list[dict], term: int) -> dict[str, dict]:
    """Collapse the live daily accumulator to one representative per month.

    The representative is the LATEST observation in the month — the same
    choice aggregate_mnd_state / aggregate_nerdwallet_state make, so the four
    monthly series stay comparable.
    """
    best: dict[str, dict] = {}
    for r in live_rows:
        d = r.get("date_iso")
        if not d or len(d) < 7:
            continue
        # Same intro-before-table precedence as the live override below.
        rate = r.get(f"intro_{term}") or r.get(f"table_{term}")
        if rate is None:
            continue
        m_label = d[:7]
        prior = best.get(m_label)
        if prior is None or d >= prior["date"]:
            best[m_label] = {"date": d, "rate": rate}
    return best


def reconcile_one(slug: str, term: int, dense: list[dict], live: dict | None,
                  live_rows: list[dict] | None = None) -> list[dict]:
    by_month = {row["month"]: row for row in dense}
    # WHY the live accumulator is consulted per-month, not just for the tail:
    # 100+ state-months (June + July 2026 across all covered states) rendered
    # as {"rate": null, "src": "no archive"} while 28-31 daily observations
    # for each sat in the JSONL. It was masked only because emit_daily_view's
    # 90-day trail still plotted them; June 2026 ages out of that trail around
    # 2026-08-30, at which point the data would leave the site entirely.
    # Wayback (dense) is the fallback now, not the primary.
    live_months = live_by_month(live_rows or [], term)
    this_month = dt.date.today().strftime("%Y-%m")
    rows = []
    for (y, m) in window_months():
        m_label = f"{y}-{m:02d}"
        lv = live_months.get(m_label)
        # The STALE_DAYS gate applies to the CURRENT month only: a stale tail
        # must not be shown as today's rate, but a completed past month is
        # settled history and its age is not a defect.
        if lv is not None and (m_label != this_month or live is not None):
            rows.append({
                "m": m_label,
                "date": lv["date"],
                "rate": lv["rate"],
                "src": "Bankrate (live)",
            })
            continue
        src_row = by_month.get(m_label)
        if src_row and src_row.get("bankrate_table_pct") is not None:
            parsed = parse_as_of(src_row.get("as_of"))
            if parsed is None:
                # No usable as_of — fall back to mid-month, but log so a
                # systematic format change upstream is visible at refresh
                # time rather than quietly misaligning the daily/monthly
                # marker logic in RateChart.
                print(
                    f"  reconcile {slug} {term}-yr {m_label}: no parsable "
                    f"as_of in {src_row!r}; defaulting to {y}-{m:02d}-15",
                    file=sys.stderr,
                )
                date_iso = f"{y}-{m:02d}-15"
            else:
                date_iso = parsed
            rows.append({
                "m": m_label,
                "date": date_iso,
                "rate": src_row["bankrate_table_pct"],
                "src": "Bankrate (Wayback)",
            })
        else:
            rows.append({"m": m_label, "date": f"{y}-{m:02d}-15", "rate": None, "src": "no archive"})

    # The old "apply live override for the latest month" block used to live
    # here. It is superseded, not dropped: the loop above already prefers the
    # live accumulator for every month it covers, including the latest, with
    # the same intro-before-table precedence and the same STALE_DAYS gate.
    return rows


def reconcile_state(slug: str) -> int:
    state = by_slug(slug)
    out_dir = state_data_dir(slug)
    os.makedirs(out_dir, exist_ok=True)
    live = load_latest_live(slug)
    live_rows = load_all_live(slug)

    write_window_json(WINDOW_JSON)

    for term in (15, 30):
        dense_path = os.path.join(out_dir, f"bankrate_{term}yr_dense.json")
        if not os.path.exists(dense_path):
            print(f"  {slug} {term}-yr: no dense file at {dense_path}; treating as empty")
            dense = []
        else:
            with open(dense_path) as f:
                dense = json.load(f)
        rows = reconcile_one(slug, term, dense, live, live_rows)
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
