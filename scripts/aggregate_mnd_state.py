"""Aggregate state-level MND JSONL into a 25-row monthly time series per term.

Reads data/daily/mnd_{slug}.jsonl, emits:
  src/data/states/{slug}/mnd_15yr.json
  src/data/states/{slug}/mnd_30yr.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import mnd_jsonl, state_data_dir  # noqa: E402
from _window import window_months  # noqa: E402
from states import by_slug  # noqa: E402


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
            except json.JSONDecodeError:
                pass
    return out


def aggregate_term(rows: list[dict], term_key: str) -> list[dict]:
    by_month: dict[tuple[int, int], dict] = {}
    for r in rows:
        d = r.get("date_iso")
        if not d or r.get(term_key) is None:
            continue
        try:
            y, mo = int(d[0:4]), int(d[5:7])
        except ValueError:
            continue
        key = (y, mo)
        prior = by_month.get(key)
        if prior is None or d > prior["date_iso"]:
            by_month[key] = r

    result = []
    for (y, mo) in window_months():
        m_label = f"{y}-{mo:02d}"
        chosen = by_month.get((y, mo))
        if chosen is None:
            result.append({"m": m_label, "date": f"{y}-{mo:02d}-15", "rate": None, "src": "no archive"})
            continue
        src = "Mortgage News Daily (Wayback)" if chosen.get("source") == "mnd_wayback" else "Mortgage News Daily"
        result.append({"m": m_label, "date": chosen["date_iso"], "rate": chosen[term_key], "src": src})
    return result


def aggregate_state(slug: str) -> int:
    state = by_slug(slug)
    rows = load_rows(mnd_jsonl(slug))
    out_dir = state_data_dir(slug)
    os.makedirs(out_dir, exist_ok=True)
    for term, key in ((15, "term_15"), (30, "term_30")):
        agg = aggregate_term(rows, key)
        n_filled = sum(1 for r in agg if r["rate"] is not None)
        out_path = os.path.join(out_dir, f"mnd_{term}yr.json")
        with open(out_path, "w") as f:
            json.dump(agg, f, indent=2)
        print(f"  {state['name']} MND {term}-yr: {n_filled}/{len(agg)} months filled -> mnd_{term}yr.json")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="north-carolina")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if args.all:
        from states import STATES
        for s in STATES:
            aggregate_state(s["slug"])
        return 0
    return aggregate_state(args.state)


if __name__ == "__main__":
    sys.exit(main())
