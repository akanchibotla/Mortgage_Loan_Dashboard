"""Emit per-state daily JSON files for the chart's daily-trail and weekly view.

For each state slug, read data/daily/{bankrate,mnd,nerdwallet}_<slug>.jsonl,
keep the last `DAYS` days, and write:

  src/data/states/<slug>/bankrate_15yr_daily.json
  src/data/states/<slug>/bankrate_30yr_daily.json
  src/data/states/<slug>/mnd_15yr_daily.json
  src/data/states/<slug>/mnd_30yr_daily.json
  src/data/states/<slug>/nerdwallet_15yr_daily.json
  src/data/states/<slug>/nerdwallet_30yr_daily.json

Row shape: {"date": "YYYY-MM-DD", "rate": 6.41, "src": "Bankrate"|"MND"|"NerdWallet"}

For Bankrate we prefer table_<term> and fall back to intro_<term>, matching
the reconcile script's preference order. Per date, the latest fetched_at_utc
wins (idempotency: re-runs overwrite same-day entries).
"""
import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import bankrate_jsonl, mnd_jsonl, nerdwallet_jsonl, state_data_dir  # noqa: E402
from states import STATES, by_slug  # noqa: E402

DAYS = 90


def load_jsonl(path: str) -> list[dict]:
    rows: list[dict] = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(
                    f"  load_jsonl({path}): skipped malformed JSON: {e}",
                    file=sys.stderr,
                )
    return rows


def cutoff_iso(days: int) -> str:
    return (dt.date.today() - dt.timedelta(days=days)).isoformat()


def _write_json(path: str, rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)


def emit_bankrate(slug: str) -> tuple[int, int]:
    cutoff = cutoff_iso(DAYS)
    rows = load_jsonl(bankrate_jsonl(slug))
    by_date: dict[str, dict] = {}
    for r in rows:
        d = r.get("date_iso")
        if not d or d < cutoff:
            continue
        prior = by_date.get(d)
        if prior is None or r.get("fetched_at_utc", "") > prior.get("fetched_at_utc", ""):
            by_date[d] = r
    out_dir = state_data_dir(slug)
    counts = []
    for term in (15, 30):
        out: list[dict] = []
        for d in sorted(by_date):
            r = by_date[d]
            rate = r.get(f"table_{term}") or r.get(f"intro_{term}")
            if rate is None:
                continue
            row = {"date": d, "rate": rate, "src": "Bankrate"}
            method = r.get("source_method")
            if method:
                row["method"] = method
            out.append(row)
        path = os.path.join(out_dir, f"bankrate_{term}yr_daily.json")
        _write_json(path, out)
        counts.append(len(out))
    return tuple(counts)  # type: ignore[return-value]


def emit_mnd(slug: str) -> tuple[int, int]:
    cutoff = cutoff_iso(DAYS)
    rows = load_jsonl(mnd_jsonl(slug))
    by_date: dict[str, dict] = {}
    for r in rows:
        d = r.get("date_iso")
        if not d or d < cutoff:
            continue
        # MND fetcher writes one canonical row per date_iso already, but be defensive.
        prior = by_date.get(d)
        if prior is None or r.get("fetched_at_utc", "") > prior.get("fetched_at_utc", ""):
            by_date[d] = r
    out_dir = state_data_dir(slug)
    counts = []
    for term in (15, 30):
        out: list[dict] = []
        for d in sorted(by_date):
            r = by_date[d]
            rate = r.get(f"term_{term}")
            if rate is None:
                continue
            row = {"date": d, "rate": rate, "src": "MND"}
            method = r.get("source_method")
            if method:
                row["method"] = method
            out.append(row)
        path = os.path.join(out_dir, f"mnd_{term}yr_daily.json")
        _write_json(path, out)
        counts.append(len(out))
    return tuple(counts)  # type: ignore[return-value]


def emit_nerdwallet(slug: str) -> tuple[int, int]:
    cutoff = cutoff_iso(DAYS)
    rows = load_jsonl(nerdwallet_jsonl(slug))
    by_date: dict[str, dict] = {}
    for r in rows:
        d = r.get("date_iso")
        if not d or d < cutoff:
            continue
        prior = by_date.get(d)
        if prior is None or r.get("fetched_at_utc", "") > prior.get("fetched_at_utc", ""):
            by_date[d] = r
    out_dir = state_data_dir(slug)
    counts = []
    for term in (15, 30):
        out: list[dict] = []
        for d in sorted(by_date):
            r = by_date[d]
            rate = r.get(f"term_{term}")
            if rate is None:
                continue
            row = {"date": d, "rate": rate, "src": "NerdWallet"}
            method = r.get("source_method")
            if method:
                row["method"] = method
            out.append(row)
        path = os.path.join(out_dir, f"nerdwallet_{term}yr_daily.json")
        _write_json(path, out)
        counts.append(len(out))
    return tuple(counts)  # type: ignore[return-value]


def emit_state(slug: str) -> None:
    state = by_slug(slug)
    b15, b30 = emit_bankrate(slug)
    m15, m30 = emit_mnd(slug)
    n15, n30 = emit_nerdwallet(slug)
    print(f"  {state['name']}: bankrate {b15}/{b30}  mnd {m15}/{m30}  nerdwallet {n15}/{n30} rows")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", help="state slug, e.g. north-carolina")
    parser.add_argument("--all", action="store_true", help="every state in STATES")
    args = parser.parse_args()
    if args.all:
        for s in STATES:
            emit_state(s["slug"])
    elif args.state:
        emit_state(args.state)
    else:
        parser.error("Provide --state SLUG or --all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
