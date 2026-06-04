"""Fetch today's MND state-level rates (15-yr + 30-yr) and append to JSONL.

MND's NC URL uses the slug `north-carolina`. Other states follow the same
pattern: `/mortgage-rates/<slug>`. Rate values are embedded in raw HTML
(no JS hydration), so a static urllib fetch works.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import fetch_html  # noqa: E402
from _paths import mnd_jsonl, mnd_today_view  # noqa: E402
from states import by_slug  # noqa: E402

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

DEFAULTS_PAT = re.compile(r'data-default-fifteen="(\d\.\d+)"\s+data-default-thirty="(\d\.\d+)"')
DATE_PAT = re.compile(r'<div class="rate-date[^"]*"[^>]*>\s*(\d{1,2}/\d{1,2}/20\d{2})\s*</div>')


def url_for(slug: str) -> str:
    return f"https://www.mortgagenewsdaily.com/mortgage-rates/{slug}"


def parse_mnd_date(s: str) -> str | None:
    try:
        return dt.datetime.strptime(s, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def write_jsonl_idempotent(path: str, new_row: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existing: list[dict] = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    existing.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    by_date = {r.get("date_iso"): r for r in existing if r.get("date_iso")}
    by_date[new_row["date_iso"]] = new_row
    with open(path, "w", encoding="utf-8") as f:
        for r in sorted(by_date.values(), key=lambda r: r.get("date_iso", "")):
            f.write(json.dumps(r) + "\n")


def write_today_view(path: str, row: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = {
        "fetched_at_utc": row["fetched_at_utc"],
        "as_of_raw": row["as_of_raw"],
        "as_of_iso": row["date_iso"],
        "term_15": {"rate_pct": row["term_15"], "as_of_iso": row["date_iso"]},
        "term_30": {"rate_pct": row["term_30"], "as_of_iso": row["date_iso"]},
    }
    with open(path, "w") as f:
        json.dump(out, f, indent=2)


def run_one(slug: str) -> int:
    state = by_slug(slug)
    print(f"Fetching MND {state['name']} ...")
    text = fetch_html(url_for(slug), HEADERS, timeout=30)
    if text is None:
        return 2
    rates_m = DEFAULTS_PAT.search(text)
    date_m = DATE_PAT.search(text)
    if not rates_m:
        print("ERROR: rate values not found", file=sys.stderr)
        return 3
    rate_15 = float(rates_m.group(1))
    rate_30 = float(rates_m.group(2))
    as_of_raw = date_m.group(1) if date_m else None
    date_iso = parse_mnd_date(as_of_raw) if as_of_raw else dt.date.today().isoformat()
    row = {
        "date_iso": date_iso,
        "term_15": rate_15,
        "term_30": rate_30,
        "as_of_raw": as_of_raw,
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "state_slug": slug,
        "source": "mnd_live",
    }
    print(f"  15-yr: {rate_15:.2f}%   30-yr: {rate_30:.2f}%   as_of: {as_of_raw}")
    write_jsonl_idempotent(mnd_jsonl(slug), row)
    write_today_view(mnd_today_view(slug), row)
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
            r = run_one(s["slug"])
            if r != 0:
                rc = r
        return rc
    return run_one(args.state)


if __name__ == "__main__":
    sys.exit(main())
