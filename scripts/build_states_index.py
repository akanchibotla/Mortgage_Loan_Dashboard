"""Walk all bundled states and build src/data/states_index.json with the
latest 15-yr and 30-yr rate per state. The home-page map reads this to color
states by current rate. Run after reconcile_state.py.
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import DATA_DIR, STATES_DIR, STATES_INDEX_JSON  # noqa: E402


def latest_rate(monthly_path: str) -> tuple[float | None, str | None]:
    if not os.path.exists(monthly_path):
        return None, None
    with open(monthly_path) as f:
        rows = json.load(f)
    for row in reversed(rows):
        if row.get("rate") is not None:
            return float(row["rate"]), row.get("m")
    return None, None


def main() -> int:
    entries = []
    if not os.path.isdir(STATES_DIR):
        print(f"No states dir at {STATES_DIR}")
        return 1
    for slug in sorted(os.listdir(STATES_DIR)):
        state_dir = os.path.join(STATES_DIR, slug)
        meta_path = os.path.join(state_dir, "state_meta.json")
        if not os.path.exists(meta_path):
            continue
        with open(meta_path) as f:
            meta = json.load(f)
        r15, m15 = latest_rate(os.path.join(state_dir, "bankrate_15yr.json"))
        r30, m30 = latest_rate(os.path.join(state_dir, "bankrate_30yr.json"))
        has_hmda = os.path.exists(os.path.join(state_dir, "hmda_2024_15yr.json"))
        has_counties = os.path.exists(os.path.join(state_dir, "counties.json"))
        # Only include states with some real data (rates or HMDA), not just metadata stubs.
        if r15 is None and r30 is None and not has_hmda:
            continue
        entries.append({
            "slug": meta["slug"],
            "postal": meta["postal"],
            "fips": meta["fips"],
            "name": meta["name"],
            "has_hmda_band": has_hmda,
            "has_counties": has_counties,
            "live_trailing": meta.get("live_trailing", False),
            "latest_15": r15,
            "latest_15_month": m15,
            "latest_30": r30,
            "latest_30_month": m30,
        })

    out = {
        "built_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "n_states": len(entries),
        "states": entries,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(STATES_INDEX_JSON, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {len(entries)} entries -> {STATES_INDEX_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
